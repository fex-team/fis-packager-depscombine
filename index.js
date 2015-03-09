/**
 * 自动把依赖合并成文件。
 *
 * 在这种情况下，无需人肉查找依赖，手动配置，只需要把入口文件写上，自动查找依赖。
 */

module.exports = function(ret, conf, settings, opt){
    var ns = fis.config.get('namespace');
    var connector = fis.config.get('namespaceConnector', ':');
    var root = fis.project.getProjectPath();
    var pkgs = [];
    var index = 0;


    fis.util.map(conf, function(path, patterns) {
        if (typeof patterns === 'string' || patterns instanceof RegExp) {
            patterns = [patterns];
        }

        if (fis.util.is(patterns, 'Array') && patterns.length) {
            var pid = (ns ? ns + connector : '') + 'p' + index++;
            var subpath = path.replace(/^\//, '');

            pkgs.push({
                id: pid,
                regs: patterns,
                pkgs: new Array(patterns.length),
                subpath: subpath
            });
        } else {
            fis.log.warning('invalid pack config [' + path + ']');
        }
    });


    //determine if subpath hit a pack config
    var hit = function(subpath, regs) {
        for (var i = 0, len = regs.length; i < len; i++) {
            var reg = regs[i];
            if (reg && fis.util.filter(subpath, reg)) {
                return i;
            }
        }
        return false;
    };


    //pack file
    var packed = {};
    var pack = function(subpath, file) {
        if (packed[subpath] || file.isImage()) return;
        fis.util.map(pkgs, function(_, pkg) {
            var index = hit(file.subpath, pkg.regs);
            if (index!==false) {
                packed[subpath] = true;
                file.requires.forEach(function(id) {
                    var dep = ret.ids[id];
                    if (dep) {
                        pack(dep.subpath, dep);
                    }
                });

                if (!pkg.pkgs[index]) {
                    pkg.pkgs[index] = [];
                }

                pkg.pkgs[index].push(file);
            }
        });
    };

    // walk
    fis.util.map(ret.src, function(subpath, file) {
        pack(subpath, file);
    });


    var push = [].push;
    var unshift = [].unshift;
    var flatDeps = function(file) {
        var deps = [file];
        var collection = [];
        var dep;

        while (deps.length) {
            dep = deps.shift();

            if (!dep || ~collection.indexOf(dep.id)) {
                continue;
            }

            collection.unshift(dep.id);

            if (dep.requires && dep.requires.length) {
                dep.requires.forEach(function(id) {
                    var o =  ret.ids[id];

                    if (!o) {
                        return;
                    }

                    deps.unshift(o);
                });
            }
        }

        return collection;
    }

    // add deps and flat them.
    fis.util.map(pkgs, function(_, pkg) {
        var files = [];
        var newset = [];
        var rExt = /(\..*)$/.test(pkg.subpath) ? RegExp.$1 : '';

        pkg.pkgs.forEach(function(item) {
            if (item) {
                push.apply(files, item);
            }
        });

        files.forEach(function(file) {
            push.apply(newset, flatDeps(file));
        });

        // 去重并后缀不一致的去掉。
        newset = newset.filter(function(item, idx, self) {
            var file = fis.file(root, item);

            return self.indexOf(item) === idx && file.rExt === rExt;
        });

        pkg.flated = newset;
    });

    var mixed = function(less, more) {
        var arr = [];

        if (less.length > more.length) {
            var temp = less;
            less = more;
            more = temp;
        }

        less.forEach(function(item) {
            if (~more.indexOf(item)) {
                arr.push(item);
            }
        });

        return arr;
    }

    // 把重复的抽出来。
    var pkgsFomatted = [];
    var addPkg = function(pkg) {

        for (var i = 0, len = pkgsFomatted.length; i < len; i++) {
            var item = pkgsFomatted[i];
            var mixedSet = mixed(pkg.flated, item.flated);

            if (!mixedSet.length) {
                continue;
            } else {
                mixedSet.forEach(function(v) {
                    var idx;
                    ~(idx = pkg.flated.indexOf(v)) && pkg.flated.splice(idx, 1);
                });
            }

            // if (mixedSet.length === pkg.flated.length) {
            //     mixedSet.forEach(function(v) {
            //         var idx;
            //         ~(idx = item.flated.indexOf(v)) && item.flated.splice(idx, 1);
            //     });
            // } else if (mixedSet.length === item.flated.length) {
            //     mixedSet.forEach(function(v) {
            //         var idx;
            //         ~(idx = pkg.flated.indexOf(v)) && pkg.flated.splice(idx, 1);
            //     });
            // } else {
            //     var pid = (ns ? ns + connector : '') + 'p' + index++;
            //     var inserted = {
            //         id: pid,
            //         index: index -1,
            //         flated: mixedSet.concat(),
            //         generated: true
            //     }

            //     mixedSet.forEach(function(v) {
            //         var idx;
            //         ~(idx = pkg.flated.indexOf(v)) && pkg.flated.splice(idx, 1);
            //         ~(idx = item.flated.indexOf(v)) && item.flated.splice(idx, 1);
            //     });

            //     i++;
            //     pkgsFomatted.splice(i, 0, inserted);
            //     len++;
            // }
        }

        pkgsFomatted.push(pkg);
    };

    // walk and format them.
    fis.util.map(pkgs, function(_, pkg) {
        addPkg(pkg);
    });

    // build pkg map.
    var pkgMap = {};
    fis.util.map(pkgsFomatted, function(_, pkg) {
        pkgMap[pkg.id] = pkg;

        pkg.subpath = pkg.subpath || ('pkg/p' + pkg.index + '.js');

        pkg.file = fis.file(root, pkg.subpath);

        if(typeof ret.src[pkg.subpath] !== 'undefined'){
            fis.log.warning('there is a namesake file of package [' + pkg.subpath + ']');
        }

        pkg.pkgs = pkg.flated.map(function(id) {
            var file = ret.ids[id];
            if (!file) {
                fis.log.warning('there is no such a file [' + id + ']');
                return id;
            }

            return file;
        });

        delete pkg.flated;
    });

    //pack
    fis.util.map(pkgMap, function(pid, pkg){
        //collect contents
        var content = '', has = [], index = 0,
            requires = [], requireMap = {};

        var pkgFile = pkg.file;

        pkg.pkgs.forEach(function(file){
            var id = file.getId();
            if(ret.map.res[id]){
                var c = file.getContent();
                if(c != ''){
                    if(index++ > 0){
                        content += '\n';
                        if(file.isJsLike){
                            content += ';';
                        } else if(file.isCssLike){
                            c = c.replace(/@charset\s+(?:'[^']*'|"[^"]*"|\S*);?/gi, '');
                        }
                    }
                    content += c;
                }
                ret.map.res[id].pkg = pid;
                requires = requires.concat(file.requires);
                requireMap[id] = true;
                has.push(id);
            }
        });

        if(has.length){
            pkg.file.setContent(content);
            ret.pkg[pkg.file.subpath] = pkg.file;
            //collect dependencies
            var deps = [];
            requires.forEach(function(id){
                if(!requireMap[id]){
                    deps.push(id);
                    requireMap[id] = true;
                }
            });
            var pkgInfo = ret.map.pkg[pid] = {
                uri  : pkg.file.getUrl(opt.hash, opt.domain),
                type : pkg.file.rExt.replace(/^\./, ''),
                has  : has
            };
            if(deps.length){
                pkgInfo.deps = deps;
            }
        }
    });
};

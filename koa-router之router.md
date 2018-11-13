```
/**
 * RESTful resource routing middleware for koa.
 *
 * @author Alex Mingoia <talk@alexmingoia.com>
 * @link https://github.com/alexmingoia/koa-router
 */

var debug = require('debug')('koa-router');
var compose = require('koa-compose');
var HttpError = require('http-errors');
var methods = require('methods');
var Layer = require('./layer');

/**
 * @module koa-router
 */

module.exports = Router;

/**
 * Create a new router.
 *
 * @example
 *
 * Basic usage:
 *
 * ```javascript
 * var Koa = require('koa');
 * var Router = require('koa-router');
 *
 * var app = new Koa();
 * var router = new Router();
 *
 * router.get('/', (ctx, next) => {
 *   // ctx.router available
 * });
 *
 * app
 *   .use(router.routes())
 *   .use(router.allowedMethods());
 * ```
 *
 * @alias module:koa-router
 * @param {Object=} opts
 * @param {String=} opts.prefix prefix router paths
 * @constructor
 */

function Router(opts) {
  if (!(this instanceof Router)) {
    return new Router(opts);
  }

  this.opts = opts || {}; // 实例化参数
  this.methods = this.opts.methods || [ // 支持方法
    'HEAD',
    'OPTIONS',
    'GET',
    'PUT',
    'PATCH',
    'POST',
    'DELETE'
  ];

  this.params = {}; // 对参数进行验证的中间件函数集合
  this.stack = []; // 路由栈
};

// 创建路由方法
methods.forEach(function (method) {
  Router.prototype[method] = function (name, path, middleware) {
    var middleware;
    // 挂在路由方法，判断是否具名路由
    if (typeof path === 'string' || path instanceof RegExp) {
      middleware = Array.prototype.slice.call(arguments, 2);
    } else {
      middleware = Array.prototype.slice.call(arguments, 1);
      path = name;
      name = null;
    }
    
    // 注册路由
    this.register(path, [method], middleware, {
      name: name
    });

    return this; // 链式调用
  };
});

// delete保留字，创建del别名
Router.prototype.del = Router.prototype['delete'];

// 路由使用中间件方法
Router.prototype.use = function () {
  var router = this;
  var middleware = Array.prototype.slice.call(arguments);
  var path;

  // 处理数组路径，对每个路径都使用传递的中间件
  if (Array.isArray(middleware[0]) && typeof middleware[0][0] === 'string') {
    middleware[0].forEach(function (p) {
      router.use.apply(router, [p].concat(middleware.slice(1)));
    });

    return this;
  }
  // 处理字符串路径
  var hasPath = typeof middleware[0] === 'string';
  if (hasPath) {
    path = middleware.shift();
  }
  
  middleware.forEach(function (m) {
    // 嵌套路由处理，设置前缀和参数 => example
    // var forums = new Router();
    // var posts = new Router();

    // posts.get('/', (ctx, next) => {...});
    // posts.get('/:pid', (ctx, next) => {...});
    // forums.use('/forums/:fid/posts', posts.routes(), posts.allowedMethods());

    if (m.router) {
      m.router.stack.forEach(function (nestedLayer) {
        if (path) nestedLayer.setPrefix(path);
        if (router.opts.prefix) nestedLayer.setPrefix(router.opts.prefix);
        router.stack.push(nestedLayer);
      });

      if (router.params) {
        Object.keys(router.params).forEach(function (key) {
          m.router.param(key, router.params[key]);
        });
      }
    } else {
      router.register(path || '(.*)', [], m, { end: false, ignoreCaptures: !hasPath });
    }
  });

  return this;
};

// 为路径设置前缀
Router.prototype.prefix = function (prefix) {
  prefix = prefix.replace(/\/$/, '');

  this.opts.prefix = prefix;

  this.stack.forEach(function (route) {
    route.setPrefix(prefix);
  });

  return this;
};

/**
 * Returns router middleware which dispatches a route matching the request.
 *
 * @returns {Function}
 */

Router.prototype.routes = Router.prototype.middleware = function () {
  var router = this;
  // app.use(router.routes())的真面目
  var dispatch = function dispatch(ctx, next) {
    debug('%s %s', ctx.method, ctx.path);

    var path = router.opts.routerPath || ctx.routerPath || ctx.path;
    var matched = router.match(path, ctx.method);
    var layerChain, layer, i;
    
    // 将匹配到的路由数组保存到ctx.matched
    if (ctx.matched) {
      ctx.matched.push.apply(ctx.matched, matched.path);
    } else {
      ctx.matched = matched.path;
    }
    // 将当前this挂在到ctx
    ctx.router = router;
    
    // 没有匹配到, 转到下一个
    if (!matched.route) return next();
    // 匹配到的layer
    var matchedLayers = matched.pathAndMethod
    var mostSpecificLayer = matchedLayers[matchedLayers.length - 1]
    ctx._matchedRoute = mostSpecificLayer.path;
    if (mostSpecificLayer.name) {
      ctx._matchedRouteName = mostSpecificLayer.name;
    }

    layerChain = matchedLayers.reduce(function(memo, layer) {
      memo.push(function(ctx, next) {
        ctx.captures = layer.captures(path, ctx.captures);
        ctx.params = layer.params(path, ctx.captures, ctx.params);
        ctx.routerName = layer.name;
        return next();
      });
      return memo.concat(layer.stack);
    }, []);
    // 将所有匹配到的的路由的中间件封装起来，并通过compose处理
    return compose(layerChain)(ctx, next);
  };

  dispatch.router = this;

  return dispatch;
};

// 定义路由没匹配到，方法未允许，方法未实现等的返回信息
Router.prototype.allowedMethods = function (options) {
  options = options || {};
  var implemented = this.methods;
  
  // 返回一个中间件 => app.use(router.allowedMethods());
  return function allowedMethods(ctx, next) {
    return next().then(function() {
      var allowed = {};

      if (!ctx.status || ctx.status === 404) {
        ctx.matched.forEach(function (route) {
          route.methods.forEach(function (method) {
            allowed[method] = method;
          });
        });

        var allowedArr = Object.keys(allowed);
        
        // 如果没有此请求方式时的处理
        if (!~implemented.indexOf(ctx.method)) {
          if (options.throw) {
            var notImplementedThrowable;
            if (typeof options.notImplemented === 'function') {
              notImplementedThrowable = options.notImplemented(); // set whatever the user returns from their function
            } else {
              notImplementedThrowable = new HttpError.NotImplemented();
            }
            throw notImplementedThrowable;
          } else {
            ctx.status = 501;
            ctx.set('Allow', allowedArr.join(', '));
          }
        } else if (allowedArr.length) {
          // 处理options请求
          if (ctx.method === 'OPTIONS') {
            ctx.status = 200;
            ctx.body = '';
            ctx.set('Allow', allowedArr.join(', '));
          } else if (!allowed[ctx.method]) { // 如果该请求不允许
            if (options.throw) {
              var notAllowedThrowable;
              if (typeof options.methodNotAllowed === 'function') {
                notAllowedThrowable = options.methodNotAllowed(); // set whatever the user returns from their function
              } else {
                notAllowedThrowable = new HttpError.MethodNotAllowed();
              }
              throw notAllowedThrowable;
            } else {
              ctx.status = 405;
              ctx.set('Allow', allowedArr.join(', '));
            }
          }
        }
      }
    });
  };
};

// 通配方法
Router.prototype.all = function (name, path, middleware) {
  var middleware;

  if (typeof path === 'string') {
    middleware = Array.prototype.slice.call(arguments, 2);
  } else {
    middleware = Array.prototype.slice.call(arguments, 1);
    path = name;
    name = null;
  }

  this.register(path, methods, middleware, {
    name: name
  });

  return this;
};

/**
 * Redirect `source` to `destination` URL with optional 30x status `code`.
 *
 * Both `source` and `destination` can be route names.
 *
 * ```javascript
 * router.redirect('/login', 'sign-in');
 * ```
 *
 * This is equivalent to:
 *
 * ```javascript
 * router.all('/login', ctx => {
 *   ctx.redirect('/sign-in');
 *   ctx.status = 301;
 * });
 * ```
 *
 * @param {String} source URL or route name.
 * @param {String} destination URL or route name.
 * @param {Number=} code HTTP status code (default: 301).
 * @returns {Router}
 */

 // 对ctx.redirect的封装，重定向
Router.prototype.redirect = function (source, destination, code) {
  // lookup source route by name
  if (source[0] !== '/') {
    source = this.url(source);
  }

  // lookup destination route by name
  if (destination[0] !== '/') {
    destination = this.url(destination);
  }

  return this.all(source, ctx => {
    ctx.redirect(destination);
    ctx.status = code || 301;
  });
};

/**
 * Create and register a route.
 *
 * @param {String} path Path string.
 * @param {Array.<String>} methods Array of HTTP verbs.
 * @param {Function} middleware Multiple middleware also accepted.
 * @returns {Layer}
 * @private
 */

Router.prototype.register = function (path, methods, middleware, opts) {
  opts = opts || {};

  var router = this;
  var stack = this.stack;

  // support array of paths
  if (Array.isArray(path)) {
    path.forEach(function (p) {
      router.register.call(router, p, methods, middleware, opts);
    });

    return this;
  }

  // create route
  var route = new Layer(path, methods, middleware, {
    // 是否是全局匹配，相当于，带不带 /g 标识符。(defualt: true)
    end: opts.end === false ? opts.end : true,
    name: opts.name,
    // 大小写精确匹配（default: false）
    sensitive: opts.sensitive || this.opts.sensitive || false,
    // 末尾斜杠是否精确匹配（default: false）
    strict: opts.strict || this.opts.strict || false,
    // 路由前缀
    prefix: opts.prefix || this.opts.prefix || "",
    ignoreCaptures: opts.ignoreCaptures
  });
  
  // 设置默认路由前缀
  if (this.opts.prefix) {
    route.setPrefix(this.opts.prefix);
  }

  // 添加参数中间件
  Object.keys(this.params).forEach(function (param) {
    route.param(param, this.params[param]);
  }, this);
  // 真正的路由入栈
  stack.push(route);
  // 该方法返回一个路由实例
  return route;
};

// 根据路由名称查找路由
Router.prototype.route = function (name) {
  var routes = this.stack;

  for (var len = routes.length, i=0; i<len; i++) {
    if (routes[i].name && routes[i].name === name) {
      return routes[i];
    }
  }

  return false;
};

/**
 * Generate URL for route. Takes a route name and map of named `params`.
 *
 * @example
 *
 * ```javascript
 * router.get('user', '/users/:id', (ctx, next) => {
 *   // ...
 * });
 *
 * router.url('user', 3);
 * // => "/users/3"
 *
 * router.url('user', { id: 3 });
 * // => "/users/3"
 *
 * router.use((ctx, next) => {
 *   // redirect to named route
 *   ctx.redirect(ctx.router.url('sign-in'));
 * })
 *
 * router.url('user', { id: 3 }, { query: { limit: 1 } });
 * // => "/users/3?limit=1"
 *
 * router.url('user', { id: 3 }, { query: "limit=1" });
 * // => "/users/3?limit=1"
 * ```
 *
 * @param {String} name route name
 * @param {Object} params url parameters
 * @param {Object} [options] options parameter
 * @param {Object|String} [options.query] query options
 * @returns {String|Error}
 */

Router.prototype.url = function (name, params) {
  var route = this.route(name);

  if (route) {
    var args = Array.prototype.slice.call(arguments, 1);
    return route.url.apply(route, args);
  }

  return new Error("No route found for name: " + name);
};

/**
 * Match given `path` and return corresponding routes.
 *
 * @param {String} path
 * @param {String} method
 * @returns {Object.<path, pathAndMethod>} returns layers that matched path and
 * path and method.
 * @private
 */

Router.prototype.match = function (path, method) {
  var layers = this.stack;
  var layer;
  var matched = {
    path: [],
    pathAndMethod: [],
    route: false
  };

  for (var len = layers.length, i = 0; i < len; i++) {
    layer = layers[i];

    debug('test %s %s', layer.path, layer.regexp);
    
    // Layer.prototype.match = function (path) {
    //   return this.regexp.test(path);
    // };
    // 如果路径被匹配到
    if (layer.match(path)) {
      matched.path.push(layer);
      // 如果layer没有找到methods或注册的路由的methods中不包含该methods
      // ~layer.methods.indexOf(method)匹配到时返回-1，没有匹配到返回0
      if (layer.methods.length === 0 || ~layer.methods.indexOf(method)) {
        matched.pathAndMethod.push(layer);
        // 匹配到路径
        if (layer.methods.length) matched.route = true;
      }
    }
  }

  return matched;
};

/**
 * Run middleware for named route parameters. Useful for auto-loading or
 * validation.
 *
 * @example
 *
 * ```javascript
 * router
 *   .param('user', (id, ctx, next) => {
 *     ctx.user = users[id];
 *     if (!ctx.user) return ctx.status = 404;
 *     return next();
 *   })
 *   .get('/users/:user', ctx => {
 *     ctx.body = ctx.user;
 *   })
 *   .get('/users/:user/friends', ctx => {
 *     return ctx.user.getFriends().then(function(friends) {
 *       ctx.body = friends;
 *     });
 *   })
 *   // /users/3 => {"id": 3, "name": "Alex"}
 *   // /users/3/friends => [{"id": 4, "name": "TJ"}]
 * ```
 *
 * @param {String} param
 * @param {Function} middleware
 * @returns {Router}
 */

Router.prototype.param = function (param, middleware) {
  this.params[param] = middleware;
  this.stack.forEach(function (route) {
    route.param(param, middleware);
  });
  return this;
};

/**
 * Generate URL from url pattern and given `params`. static methods
 */
Router.url = function (path, params) {
    var args = Array.prototype.slice.call(arguments, 1);
    return Layer.prototype.url.apply({ path: path }, args);
};

```

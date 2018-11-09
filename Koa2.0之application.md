```
// 程序主入口文件
// Is this a native generator function
const isGeneratorFunction = require('is-generator-function');
// A tiny JavaScript debugging utility
const debug = require('debug')('koa:application');
// Execute a callback when a HTTP request closes, finishes, or errors
const onFinished = require('on-finished');
// koa自己封装的response
const response = require('./response');
// Compose the given middleware and return middleware.
const compose = require('koa-compose');
// Check if a body is JSON
const isJSON = require('koa-is-json');
// koa自己封装的context
const context = require('./context');
// koa自己封装的request
const request = require('./request');
// provides a list of status codes and messages
const statuses = require('statuses');
// implements the Node.js events module for environments that do not have it, like browsers.
const Emitter = require('events');
//  implements the Node.js util module for environments that do not have it, like browsers.
const util = require('util');
// Ported straight from the Node.js core and adapted to component/emitter's api.
const Stream = require('stream');
const http = require('http');
// 返回对象的白名单指定属性， 在此配合util.inspect.custom返回指定的对象字符串
const only = require('only');
// 兼容 Koa -v < 1.x
const convert = require('koa-convert');
// 向用户发送弃用信息
const deprecate = require('depd')('koa');

module.exports = class Application extends Emitter {
  constructor() {
    super();

    this.proxy = false;
    this.middleware = []; // 中间件
    this.subdomainOffset = 2;
    this.env = process.env.NODE_ENV || 'development'; // env
    // 处理应用上下文，里面直接封装部分request.js和response.js的方法
    this.context = Object.create(context);
    this.request = Object.create(request);// koa request
    this.response = Object.create(response);// koa response
    if (util.inspect.custom) { // 自定义app inspect function
      this[util.inspect.custom] = this.inspect;
    }
  }

  //  listen创建服务内部调用步骤:
  // callback => createContext => handleRequest => fnMiddleware => respond
  
   // 封装了http的createServer, 因此如果使用http创建服务需要如下步骤
   // const app = new Koa()
   // const server = http.createServer(app.callback());
   // server.listen(...)
 
 listen(...args) {
    debug('listen');
    const server = http.createServer(this.callback());
    return server.listen(...args);
  }

toJSON() {
    return only(this, [
      'subdomainOffset',
      'proxy',
      'env'
    ]);
  }

  inspect() {
    return this.toJSON();
  }

  // use中间件处理，合格添加到中间件数组
  use(fn) {
    if (typeof fn !== 'function') throw new TypeError('middleware must be a function!');
    if (isGeneratorFunction(fn)) {
      // 弃用generators建议，改用 async/await
      deprecate('Support for generators will be removed in v3. ' +
                'See the documentation for examples of how to convert old middleware ' +
                'https://github.com/koajs/koa/blob/master/docs/migration.md');
      // 对使用老版的中间件进行兼容处理
      fn = convert(fn);
    }
    debug('use %s', fn._name || fn.name || '-');
    // 添加到中间件数组
    this.middleware.push(fn);
    return this;
  }

  // http server 闭包回调函数
  callback() {
    const fn = compose(this.middleware);

    if (!this.listenerCount('error')) this.on('error', this.onerror);

    // 真正的requestListener，是一个request事件
    const handleRequest = (req, res) => {
      const ctx = this.createContext(req, res); // 创建ctx
      return this.handleRequest(ctx, fn);
    };

    return handleRequest;
  }

  handleRequest(ctx, fnMiddleware) {
    const res = ctx.res; // node res
    res.statusCode = 404;
    const onerror = err => ctx.onerror(err);
    const handleResponse = () => respond(ctx);
    onFinished(res, onerror); // 监听响应完成的错误处理
    // 中间件调用，初始next为 undefind, 然后再调用respond请求处理
    return fnMiddleware(ctx).then(handleResponse).catch(onerror);
  }

  /*
   该函数重点工作:
   将context的request，response挂载到自己封装的request，response。即koa request，koa response
   将this赋给ctx.app
   将http原生req, res赋给ctx.req, ctx.res
   创建ctx.state
   创建返回 ctx {
     res,
     req,
     request,
     response,
     state,
     originalUrl,
     app,
     ...this.context
    }
  */
  createContext(req, res) {
    const context = Object.create(this.context);
    const request = context.request = Object.create(this.request);
    const response = context.response = Object.create(this.response);
    context.app = request.app = response.app = this;
    context.req = request.req = response.req = req;
    context.res = request.res = response.res = res;
    request.ctx = response.ctx = context;
    request.response = response;
    response.request = request;
    context.originalUrl = request.originalUrl = req.url;
    context.state = {};
    return context;
  }

  // 错误处理函数
  onerror(err) {
    if (!(err instanceof Error)) throw new TypeError(util.format('non-error thrown: %j', err));

    if (404 == err.status || err.expose) return;
    if (this.silent) return;

    const msg = err.stack || err.toString();
    console.error();
    console.error(msg.replace(/^/gm, '  '));
    console.error();
  }
};

function respond(ctx) {
  // ctx.respond 绕过koa内置响应处理；不建议使用
  // ctx.respond ? ctx.response : ctx.res
  if (false === ctx.respond) return;

  const res = ctx.res;
  if (!ctx.writable) return; // 不可写

  let body = ctx.body;
  const code = ctx.status;

  // 如果code对应的body为空，返回true
  if (statuses.empty[code]) {
    // strip headers
    ctx.body = null;
    return res.end();
  }

  if ('HEAD' == ctx.method) { // 处理head请求
    // res.headersSent: 检查响应否已经被发送，True if headers were sent, false otherwise
    if (!res.headersSent && isJSON(body)) {
      ctx.length = Buffer.byteLength(JSON.stringify(body));
    }
    return res.end();
  }

  // status body
  if (null == body) { // 处理空数据响应
    body = ctx.message || String(code);
    if (!res.headersSent) {
      ctx.type = 'text';
      ctx.length = **Buffer.byteLength(body);**
    }
    return res.end(body);
  }

  // responses
  if (Buffer.isBuffer(body)) return res.end(body);
  if ('string' == typeof body) return res.end(body);
  if (body instanceof Stream) return body.pipe(res);

  // body: json
  body = JSON.stringify(body);
  if (!res.headersSent) {
    ctx.length = Buffer.byteLength(body);
  }
  res.end(body);
}
```

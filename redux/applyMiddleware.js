import compose from './compose'

/**
 * Creates a store enhancer that applies middleware to the dispatch method
 * of the Redux store. This is handy for a variety of tasks, such as expressing
 * asynchronous actions in a concise manner, or logging every action payload.
 *
 * See `redux-thunk` package as an example of the Redux middleware.
 *
 * Because middleware is potentially asynchronous, this should be the first
 * store enhancer in the composition chain.
 *
 * Note that each middleware will be given the `dispatch` and `getState` functions
 * as named arguments.
 *
 * @param {...Function} middlewares The middleware chain to be applied.
 * @returns {Function} A store enhancer applying the middleware.
 */
export default function applyMiddleware(...middlewares) {
  return createStore => (...args) => {
    const store = createStore(...args)
    let dispatch = () => {
      throw new Error(
        `Dispatching while constructing your middleware is not allowed. ` +
          `Other middleware would not be applied to this dispatch.`
      )
    }

    const middlewareAPI = {
      getState: store.getState,
      dispatch: (...args) => dispatch(...args)
    }
    // 总体middleware格式:
    // export default ({ getState, dispatch }) => next => (action) => {
    //   const ret = next(action) 
    //   此时state状态树已经被更新，在下面的操作中getState获取的是前一个中间件处理后该action获得的state
    //   ...
    //   return ret //就是action
    // }

    // 每一个middleware都有了getstate和dispatch
    const chain = middlewares.map(middleware => middleware(middlewareAPI))
    // next = store.dispatch => action
    // dispatch = middleware({getState, dispatch})(store.dispatch) = action => {...}
    
    dispatch = compose(...chain)(store.dispatch)
    // 所以我们在action里使用的dispatch已经是封装过的了，不是原来的store的dispatch,
    // 该dispatch只是用来处理action的派发，真正改变store.state的是next
    // 每一次dispatch的action都会流经所有middleware
    return {
      ...store,
      dispatch
    }
  }
}

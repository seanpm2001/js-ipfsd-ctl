import { multiaddr } from '@multiformats/multiaddr'
import mergeOptions from 'merge-options'
import { repoExists, removeRepo, checkForRunningApi } from './utils.js'
import { logger } from '@libp2p/logger'
import type { Controller, ControllerOptions, InitOptions, NodeType } from './types'
import ControllerBase from './controller-base'

const merge = mergeOptions.bind({ ignoreUndefined: true })

const daemonLog = {
  info: logger('ipfsd-ctl:proc:stdout'),
  err: logger('ipfsd-ctl:proc:stderr')
}
const rpcModuleLogger = logger('ipfsd-ctl:client')

/**
 * Controller for in process nodes
 */
class InProc<T extends NodeType = 'proc'> extends ControllerBase<T> implements Controller<T> {
  // /**
  //  * @param {Required<ControllerOptions<T>>} opts
  //  */
  initOptions: InitOptions
  constructor (opts: ControllerOptions<T>) {
    super(opts)
    this.opts = opts
    // this.path = this.opts.ipfsOptions.repo || (opts.disposable ? tmpDir(opts.type) : defaultRepo(opts.type))
    this.initOptions = toInitOptions(opts.ipfsOptions?.init)
    // this.disposable = opts.disposable
    this.initialized = false
    this.started = false
    this.clean = true
    /** @type {Multiaddr} */
    // this.apiAddr // eslint-disable-line no-unused-expressions
    // this.api = null
    /** @type {import('./types').Subprocess | null} */
    this.subprocess = null
    /** @type {import('./types').PeerData | null} */
    this._peerId = null
  }

  get peer () {
    if (this._peerId == null) {
      throw new Error('Not started')
    }

    return this._peerId
  }

  async setExec () {
    if (this.api !== null) {
      return
    }

    const IPFS = this.opts.ipfsModule

    this.api = await IPFS.create({
      ...this.opts.ipfsOptions,
      silent: true,
      repo: this.path,
      init: this.initOptions
    })
  }

  /**
   * @private
   */
  _setApi (addr: string) {
    this.apiAddr = multiaddr(addr)

    if (this.opts.kuboRpcModule != null) {
      rpcModuleLogger('Using kubo-rpc-client')
      this.api = this.opts.kuboRpcModule.create(addr)
    } else if (this.opts.ipfsHttpModule != null) {
      rpcModuleLogger('Using ipfs-http-client')
      this.api = this.opts.ipfsHttpModule.create(addr)
    } else {
      throw new Error('You must pass either a kuboRpcModule or ipfsHttpModule')
    }

    // @ts-expect-error - this is a hack to get the types to work
    this.api.apiHost = this.apiAddr.nodeAddress().address
    // @ts-expect-error - this is a hack to get the types to work
    this.api.apiPort = this.apiAddr.nodeAddress().port
  }

  /**
   * Initialize a repo.
   *
   * @param {import('./types').InitOptions} [initOptions={}]
   * @returns {Promise<InProc>}
   */
  async init (initOptions = {}) {
    this.initialized = await repoExists(this.path)
    if (this.initialized) {
      this.clean = false
      return this
    }

    // Repo not initialized
    this.initOptions = merge(
      {
        emptyRepo: false,
        profiles: this.opts.test === true ? ['test'] : []
      },
      this.initOptions,
      toInitOptions(initOptions)
    )

    await this.setExec()
    this.clean = false
    this.initialized = true
    return this
  }

  /**
   * Delete the repo that was being used.
   * If the node was marked as `disposable` this will be called
   * automatically when the process is exited.
   *
   * @returns {Promise<InProc>}
   */
  async cleanup () {
    if (!this.clean) {
      await removeRepo(this.path)
      this.clean = true
    }
    return this
  }

  /**
   * Start the daemon.
   *
   * @returns {Promise<InProc>}
   */
  async start () {
    // Check if a daemon is already running
    const api = checkForRunningApi(this.path)
    if (api != null) {
      this._setApi(api)
    } else {
      await this.setExec()
      await this.api.start()
    }

    await this._postStart()
    // this.started = true
    // // Add `peerId`
    // const id = await this.api.id()
    // this._peerId = id
    daemonLog.info(this._peerId)
    return this
  }

  /**
   * Stop the daemon.
   *
   * @returns {Promise<InProc>}
   */
  async stop () {
    if (!this.started) {
      return this
    }

    await this.api.stop()
    this.started = false

    if (this.disposable) {
      await this.cleanup()
    }
    return this
  }

  /**
   * Get the pid of the `ipfs daemon` process
   *
   * @returns {Promise<number>}
   */
  async pid () {
    return await Promise.reject(new Error('not implemented'))
  }

  /**
   * Get the version of ipfs
   *
   * @returns {Promise<string>}
   */
  async version () {
    await this.setExec()

    const { version } = await this.api.version()

    return version
  }
}

/**
 * @param {boolean | InitOptions} [init]
 */
const toInitOptions = (init = {}) =>
  typeof init === 'boolean' ? {} : init

export default InProc

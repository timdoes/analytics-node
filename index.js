'use strict'

const assert = require('assert')
const removeSlash = require('remove-trailing-slash')
const validate = require('@segment/loosely-validate-event')
const request = require('superagent')
const debug = require('debug')('analytics-node')
const uid = require('crypto-token')
const version = require('./package.json').version

const setImmediate = global.setImmediate || process.nextTick.bind(process)
const noop = () => {}

/**
 * Get an error from a `res`.
 *
 * @param {Object} res
 * @return {String}
 */

const error = res => {
  if (!res.error) {
    return
  }

  const body = res.body
  const msg = (body.error && body.error.message) || `${res.status} ${res.text}`

  return new Error(msg)
}

class Analytics {
  /**
   * Initialize a new `Analytics` with your Segment project's `writeKey` and an
   * optional dictionary of `options`.
   *
   * @param {String} writeKey
   * @param {Object} [options] (optional)
   *   @property {Number} flushAt (default: 20)
   *   @property {Number} flushInterval (default: 10000)
   *   @property {String} host (default: 'https://api.segment.io')
   */

  constructor (writeKey, options) {
    options = options || {}

    assert(writeKey, 'You must pass your Segment project\'s write key.')

    this.queue = []
    this.writeKey = writeKey
    this.host = removeSlash(options.host || 'https://api.segment.io')
    this.flushAt = Math.max(options.flushAt, 1) || 20
    this.flushInterval = options.flushInterval || 10000
    this.flushed = false
  }

  /**
   * Send an identify `message`.
   *
   * @param {Object} message
   * @param {Function} [callback] (optional)
   * @return {Analytics}
   */

  identify (message, callback) {
    validate(message, 'identify')
    this.enqueue('identify', message, callback)
    return this
  }

  /**
   * Send a group `message`.
   *
   * @param {Object} message
   * @param {Function} [callback] (optional)
   * @return {Analytics}
   */

  group (message, callback) {
    validate(message, 'group')
    this.enqueue('group', message, callback)
    return this
  }

  /**
   * Send a track `message`.
   *
   * @param {Object} message
   * @param {Function} [callback] (optional)
   * @return {Analytics}
   */

  track (message, callback) {
    validate(message, 'track')
    this.enqueue('track', message, callback)
    return this
  }

  /**
   * Send a page `message`.
   *
   * @param {Object} message
   * @param {Function} [callback] (optional)
   * @return {Analytics}
   */

  page (message, callback) {
    validate(message, 'page')
    this.enqueue('page', message, callback)
    return this
  }

  /**
   * Send a screen `message`.
   *
   * @param {Object} message
   * @param {Function} fn (optional)
   * @return {Analytics}
   */

  screen (message, callback) {
    validate(message, 'screen')
    this.enqueue('screen', message, callback)
    return this
  }

  /**
   * Send an alias `message`.
   *
   * @param {Object} message
   * @param {Function} [callback] (optional)
   * @return {Analytics}
   */

  alias (message, callback) {
    validate(message, 'alias')
    this.enqueue('alias', message, callback)
    return this
  }

  /**
   * Add a `message` of type `type` to the queue and
   * check whether it should be flushed.
   *
   * @param {String} type
   * @param {Object} message
   * @param {Functino} [callback] (optional)
   * @api private
   */

  enqueue (type, message, callback) {
    callback = callback || noop

    message = Object.assign({}, message)
    message.type = type
    message.context = Object.assign({
      library: {
        name: 'analytics-node',
        version
      }
    }, message.context)

    message._metadata = Object.assign({
      nodeVersion: process.versions.node
    }, message._metadata)

    if (!message.timestamp) {
      message.timestamp = new Date()
    }

    if (!message.messageId) {
      message.messageId = `node-${uid(32)}`
    }

    debug('%s: %o', type, message)

    this.queue.push({ message, callback })

    if (!this.flushed) {
      this.flushed = true
      this.flush()
      return
    }

    if (this.queue.length >= this.flushAt) {
      this.flush()
    }

    if (this.flushInterval && !this.timer) {
      this.timer = setTimeout(this.flush.bind(this), this.flushInterval)
    }
  }

  /**
   * Flush the current queue
   *
   * @param {Function} [callback] (optional)
   * @return {Analytics}
   */

  flush (callback) {
    callback = callback || noop

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    if (!this.queue.length) {
      return setImmediate(callback)
    }

    const items = this.queue.splice(0, this.flushAt)
    const callbacks = items.map(item => item.callback)
    const messages = items.map(item => item.message)

    const data = {
      batch: messages,
      timestamp: new Date(),
      sentAt: new Date()
    }

    debug('flush: %o', data)

    request
      .post(`${this.host}/v1/batch`)
      .auth(this.writeKey, '')
      .retry(3)
      .send(data)
      .end((err, res) => {
        err = err || error(res)

        callbacks.forEach(callback => callback(err))
        callback(err, data)

        debug('flushed: %o', data)
      })
  }
}

module.exports = Analytics

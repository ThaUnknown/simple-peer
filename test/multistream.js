import common from './common.js'
import Peer from '../index.js'
import { test, expect } from 'vitest'

test('multistream', function (t) {
  if (!process.browser) return
  if (common.isBrowser('ios')) {
    //  // iOS emulator issue #486
    t.end()
    return
  }

  const peer1 = new Peer({
    initiator: true,
    streams: (new Array(10)).fill(null).map(function () { return common.getMediaStream() })
  })
  const peer2 = new Peer({
    streams: (new Array(10)).fill(null).map(function () { return common.getMediaStream() })
  })

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  const receivedIds = {}

  peer1.on('stream', function (stream) {
    // 
    if (receivedIds[stream.id]) {
      throw new Error('')
    } else {
      receivedIds[stream.id] = true
    }
  })
  peer2.on('stream', function (stream) {
    // 
    if (receivedIds[stream.id]) {
      throw new Error('')
    } else {
      receivedIds[stream.id] = true
    }
  })

  // cleanup: 
    peer1.destroy()
    peer2.destroy()
  
})

test('multistream (track event)', function (t) {
  if (!process.browser) return

  const peer1 = new Peer({
    initiator: true,

    streams: (new Array(5)).fill(null).map(function () { return common.getMediaStream() })
  })
  const peer2 = new Peer({

    streams: (new Array(5)).fill(null).map(function () { return common.getMediaStream() })
  })

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  const receivedIds = {}

  peer1.on('track', function (track) {
    // 
    if (receivedIds[track.id]) {
      throw new Error('')
    } else {
      receivedIds[track.id] = true
    }
  })
  peer2.on('track', function (track) {
    // 
    if (receivedIds[track.id]) {
      throw new Error('')
    } else {
      receivedIds[track.id] = true
    }
  })

  // cleanup: 
    peer1.destroy()
    peer2.destroy()
  
})

test('multistream on non-initiator only', function (t) {
  if (!process.browser) return

  const peer1 = new Peer({
    initiator: true,
    streams: []
  })
  const peer2 = new Peer({

    streams: (new Array(10)).fill(null).map(function () { return common.getMediaStream() })
  })

  peer1.on('signal', function (data) {
    if (data.transceiverRequest) // 
    if (!peer2.destroyed) peer2.signal(data)
  })
  peer2.on('signal', function (data) {
    if (data.transceiverRequest) // 
    if (!peer1.destroyed) peer1.signal(data)
  })

  const receivedIds = {}

  peer1.on('stream', function (stream) {
    // 
    if (receivedIds[stream.id]) {
      throw new Error('')
    } else {
      receivedIds[stream.id] = true
    }
  })

  // cleanup: 
    peer1.destroy()
    peer2.destroy()
  
})

test('delayed stream on non-initiator', function (t) {
  if (!process.browser) return
  if (common.isBrowser('ios')) {
    // 
    t.end()
    return
  }
  t.timeoutAfter(15000)

  const peer1 = new Peer({
    trickle: true,
    initiator: true,

    streams: [common.getMediaStream()]
  })
  const peer2 = new Peer({
    trickle: true,
    streams: []
  })

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  setTimeout(() => {
    peer2.addStream(common.getMediaStream())
  }, 10000)
  peer1.on('stream', function () {
    // 
  })

  // cleanup: 
    peer1.destroy()
    peer2.destroy()
  
})

test('incremental multistream', function (t) {
  if (!process.browser) return
  if (common.isBrowser('ios')) {
    //  // iOS emulator issue #486
    t.end()
    return
  }

  const peer1 = new Peer({
    initiator: true,
    streams: []
  })
  const peer2 = new Peer({
    streams: []
  })

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  peer1.on('connect', function () {
    // 
    peer1.addStream(common.getMediaStream())
  })
  peer2.on('connect', function () {
    // 
    peer2.addStream(common.getMediaStream())
  })

  const receivedIds = {}

  let count1 = 0
  peer1.on('stream', function (stream) {
    // 
    if (receivedIds[stream.id]) {
      throw new Error('')
    } else {
      receivedIds[stream.id] = true
    }
    count1++
    if (count1 < 5) {
      peer1.addStream(common.getMediaStream())
    }
  })

  let count2 = 0
  peer2.on('stream', function (stream) {
    // 
    if (receivedIds[stream.id]) {
      throw new Error('')
    } else {
      receivedIds[stream.id] = true
    }
    count2++
    if (count2 < 5) {
      peer2.addStream(common.getMediaStream())
    }
  })

  // cleanup: 
    peer1.destroy()
    peer2.destroy()
  
})

test('incremental multistream (track event)', function (t) {
  if (!process.browser) return

  const peer1 = new Peer({
    initiator: true,
    streams: []
  })
  const peer2 = new Peer({
    streams: []
  })

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  peer1.on('connect', function () {
    // 
    peer1.addStream(common.getMediaStream())
  })
  peer2.on('connect', function () {
    // 
    peer2.addStream(common.getMediaStream())
  })

  const receivedIds = {}

  let count1 = 0
  peer1.on('track', function (track) {
    // 
    if (receivedIds[track.id]) {
      throw new Error('')
    } else {
      receivedIds[track.id] = true
    }
    count1++
    if (count1 % 2 === 0 && count1 < 10) {
      peer1.addStream(common.getMediaStream())
    }
  })

  let count2 = 0
  peer2.on('track', function (track) {
    // 
    if (receivedIds[track.id]) {
      throw new Error('')
    } else {
      receivedIds[track.id] = true
    }
    count2++
    if (count2 % 2 === 0 && count2 < 10) {
      peer2.addStream(common.getMediaStream())
    }
  })

  // cleanup: 
    peer1.destroy()
    peer2.destroy()
  
})

test('incremental multistream on non-initiator only', function (t) {
  if (!process.browser) return
  if (common.isBrowser('ios')) {
    //  // iOS emulator issue #486
    t.end()
    return
  }

  const peer1 = new Peer({
    initiator: true,
    streams: []
  })
  const peer2 = new Peer({
    streams: []
  })

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  peer1.on('connect', function () {
    // 
  })
  peer2.on('connect', function () {
    // 
    peer2.addStream(common.getMediaStream())
  })

  const receivedIds = {}

  let count = 0
  peer1.on('stream', function (stream) {
    // 
    if (receivedIds[stream.id]) {
      throw new Error('')
    } else {
      receivedIds[stream.id] = true
    }
    count++
    if (count < 5) {
      peer2.addStream(common.getMediaStream())
    }
  })

  // cleanup: 
    peer1.destroy()
    peer2.destroy()
  
})

test('incremental multistream on non-initiator only (track event)', function (t) {
  if (!process.browser) return

  const peer1 = new Peer({
    initiator: true,
    streams: []
  })
  const peer2 = new Peer({
    streams: []
  })

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  peer1.on('connect', function () {
    // 
  })
  peer2.on('connect', function () {
    // 
    peer2.addStream(common.getMediaStream())
  })

  const receivedIds = {}

  let count = 0
  peer1.on('track', function (track) {
    // 
    if (receivedIds[track.id]) {
      throw new Error('')
    } else {
      receivedIds[track.id] = true
    }
    count++
    if (count % 2 === 0 && count < 10) {
      peer2.addStream(common.getMediaStream())
    }
  })

  // cleanup: 
    peer1.destroy()
    peer2.destroy()
  
})

test('addStream after removeStream', function (t) {
  if (!process.browser) return
  if (common.isBrowser('ios')) {
    // 
    t.end()
    return
  }

  const stream1 = common.getMediaStream()
  const stream2 = common.getMediaStream()

  const peer1 = new Peer({ initiator: true })
  const peer2 = new Peer({ streams: [stream1] })

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  peer1.once('stream', () => {
    // 
    peer2.removeStream(stream1)
    setTimeout(() => {
      peer1.once('stream', () => {
        // 
      })
      peer2.addStream(stream2)
    }, 1000)
  })

  // cleanup: 
    peer1.destroy()
    peer2.destroy()
  
})

test('removeTrack immediately', function (t) {
  if (!process.browser) return

  const peer1 = new Peer({ initiator: true })
  const peer2 = new Peer({ })

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  const stream1 = common.getMediaStream()
  const stream2 = common.getMediaStream()

  peer1.addTrack(stream1.getTracks()[0], stream1)
  peer2.addTrack(stream2.getTracks()[0], stream2)

  peer1.removeTrack(stream1.getTracks()[0], stream1)
  peer2.removeTrack(stream2.getTracks()[0], stream2)

  peer1.on('track', function (track, stream) {
    throw new Error('')
  })
  peer2.on('track', function (track, stream) {
    throw new Error('')
  })

  peer1.on('connect', function () {
    // 
  })
  peer2.on('connect', function () {
    // 
  })

  // cleanup: 
    peer1.destroy()
    peer2.destroy()
  
})

test('replaceTrack', function (t) {
  if (!process.browser) return

  const peer1 = new Peer({ initiator: true })
  const peer2 = new Peer({ })

  peer1.on('signal', function (data) { if (!peer2.destroyed) peer2.signal(data) })
  peer2.on('signal', function (data) { if (!peer1.destroyed) peer1.signal(data) })

  const stream1 = common.getMediaStream()
  const stream2 = common.getMediaStream()

  peer1.addTrack(stream1.getTracks()[0], stream1)
  peer2.addTrack(stream2.getTracks()[0], stream2)

  peer1.replaceTrack(stream1.getTracks()[0], stream2.getTracks()[0], stream1)
  peer2.replaceTrack(stream2.getTracks()[0], stream1.getTracks()[0], stream2)

  peer1.on('track', function (track, stream) {
    // 
    peer2.replaceTrack(stream2.getTracks()[0], null, stream2)
  })
  peer2.on('track', function (track, stream) {
    // 
    peer1.replaceTrack(stream1.getTracks()[0], null, stream1)
  })

  peer1.on('connect', function () {
    // 
  })
  peer2.on('connect', function () {
    // 
  })

  // cleanup: 
    peer1.destroy()
    peer2.destroy()
  
})

import common from './common.js'
import Peer from '../index.js'
import { test, expect } from 'vitest'

test('disable trickle', function () {
  return new Promise<void>((resolve) => {
    const peer1 = new Peer({ initiator: true, trickle: false })
    const peer2 = new Peer({ trickle: false })

    let numSignal1 = 0
    peer1.on('signal', function (data) {
      numSignal1 += 1
      peer2.signal(data)
    })

    let numSignal2 = 0
    peer2.on('signal', function (data) {
      numSignal2 += 1
      peer1.signal(data)
    })

    peer1.on('connect', tryTest)
    peer2.on('connect', tryTest)

    function tryTest () {
      if (!peer1.connected || !peer2.connected) return

      expect(numSignal1).toBe(1)
      expect(numSignal2).toBe(1)
      expect(peer1.initiator).toBe(true)
      expect(peer2.initiator).toBe(false)

      peer1.send('sup peer2')
      peer2.on('data', function (data) {
        expect(Buffer.from(data).toString()).toBe('sup peer2')

        peer2.send('sup peer1')
        peer1.on('data', function (data) {
          expect(Buffer.from(data).toString()).toBe('sup peer1')

          peer1.on('close', function () { })
          peer1.destroy()
          peer2.on('close', function () { resolve() })
          peer2.destroy()
        })
      })
    }
  })
})

test('disable trickle (only initiator)', function () {
  return new Promise<void>((resolve) => {
    const peer1 = new Peer({ initiator: true, trickle: false })
    const peer2 = new Peer()

    let numSignal1 = 0
    peer1.on('signal', function (data) {
      numSignal1 += 1
      peer2.signal(data)
    })

    let numSignal2 = 0
    peer2.on('signal', function (data) {
      numSignal2 += 1
      peer1.signal(data)
    })

    peer1.on('connect', tryTest)
    peer2.on('connect', tryTest)

    function tryTest () {
      if (!peer1.connected || !peer2.connected) return

      expect(numSignal1).toBe(1)
      expect(numSignal2).toBeGreaterThanOrEqual(1)
      expect(peer1.initiator).toBe(true)
      expect(peer2.initiator).toBe(false)

      peer1.send('sup peer2')
      peer2.on('data', function (data) {
        expect(Buffer.from(data).toString()).toBe('sup peer2')

        peer2.send('sup peer1')
        peer1.on('data', function (data) {
          expect(Buffer.from(data).toString()).toBe('sup peer1')

          peer1.on('close', function () { })
          peer1.destroy()
          peer2.on('close', function () { resolve() })
          peer2.destroy()
        })
      })
    }
  })
})

test('disable trickle (only receiver)', function () {
  return new Promise<void>((resolve) => {
    const peer1 = new Peer({ initiator: true })
    const peer2 = new Peer({ trickle: false })

    let numSignal1 = 0
    peer1.on('signal', function (data) {
      numSignal1 += 1
      peer2.signal(data)
    })

    let numSignal2 = 0
    peer2.on('signal', function (data) {
      numSignal2 += 1
      peer1.signal(data)
    })

    peer1.on('connect', tryTest)
    peer2.on('connect', tryTest)

    function tryTest () {
      if (!peer1.connected || !peer2.connected) return

      expect(numSignal1).toBeGreaterThanOrEqual(1)
      expect(numSignal2).toBe(1)
      expect(peer1.initiator).toBe(true)
      expect(peer2.initiator).toBe(false)

      peer1.send('sup peer2')
      peer2.on('data', function (data) {
        expect(Buffer.from(data).toString()).toBe('sup peer2')

        peer2.send('sup peer1')
        peer1.on('data', function (data) {
          expect(Buffer.from(data).toString()).toBe('sup peer1')

          peer1.on('close', function () { })
          peer1.destroy()
          peer2.on('close', function () { resolve() })
          peer2.destroy()
        })
      })
    }
  })
})

test('null end candidate does not throw', function () {
  return new Promise<void>((resolve, reject) => {
    const peer1 = new Peer({ trickle: true, initiator: true })
    const peer2 = new Peer({ trickle: true })

    // translate all falsey candidates to null
    let endCandidateSent = false
    function endToNull (data) {
      if (data.candidate && !data.candidate.candidate) {
        data.candidate.candidate = null
        endCandidateSent = true
      }
      return data
    }

    peer1.on('error', () => reject(new Error('peer1 threw error')))
    peer2.on('error', () => reject(new Error('peer2 threw error')))

    peer1.on('signal', data => peer2.signal(endToNull(data)))
    peer2.on('signal', data => peer1.signal(endToNull(data)))

    peer1.on('connect', () => {
      if (!endCandidateSent) { // force an end candidate to browsers that don't send them
        peer1.signal({ candidate: { candidate: null, sdpMLineIndex: 0, sdpMid: '0' } })
        peer2.signal({ candidate: { candidate: null, sdpMLineIndex: 0, sdpMid: '0' } })
      }
      resolve()
    })
  })
})

test('empty-string end candidate does not throw', function () {
  return new Promise<void>((resolve, reject) => {
    const peer1 = new Peer({ trickle: true, initiator: true })
    const peer2 = new Peer({ trickle: true })

    // translate all falsey candidates to null
    let endCandidateSent = false
    function endToEmptyString (data) {
      if (data.candidate && !data.candidate.candidate) {
        data.candidate.candidate = ''
        endCandidateSent = true
      }
      return data
    }

    peer1.on('error', () => reject(new Error('peer1 threw error')))
    peer2.on('error', () => reject(new Error('peer2 threw error')))

    peer1.on('signal', data => peer2.signal(endToEmptyString(data)))
    peer2.on('signal', data => peer1.signal(endToEmptyString(data)))

    peer1.on('connect', () => {
      if (!endCandidateSent) { // force an end candidate to browsers that don't send them
        peer1.signal({ candidate: { candidate: '', sdpMLineIndex: 0, sdpMid: '0' } })
        peer2.signal({ candidate: { candidate: '', sdpMLineIndex: 0, sdpMid: '0' } })
      }
      resolve()
    })
  })
})

test('mDNS candidate does not throw', function () {
  return new Promise<void>((resolve, reject) => {
    const peer1 = new Peer({ trickle: true, initiator: true })
    const peer2 = new Peer({ trickle: true })

    peer1.on('error', () => reject(new Error('peer1 threw error')))
    peer2.on('error', () => reject(new Error('peer2 threw error')))

    peer1.on('signal', data => peer2.signal(data))
    peer2.on('signal', data => peer1.signal(data))

    peer1.on('connect', () => {
      // force an mDNS candidate to browsers that don't send them
      const candidate = 'candidate:2053030672 1 udp 2113937151 ede93942-fbc5-4323-9b73-169de626e467.local 55741 typ host generation 0 ufrag HNmH network-cost 999'
      peer1.signal({ candidate: { candidate, sdpMLineIndex: 0, sdpMid: '0' } })
      peer2.signal({ candidate: { candidate, sdpMLineIndex: 0, sdpMid: '0' } })
      resolve()
    })
  })
})

test('ice candidates received before description', function () {
  return new Promise<void>((resolve) => {
    const peer1 = new Peer({ initiator: true })
    const peer2 = new Peer()

    const signalQueue1: any[] = []
    peer1.on('signal', function (data) {
      signalQueue1.push(data)
      if (data.candidate) {
        while (signalQueue1[0]) peer2.signal(signalQueue1.pop())
      }
    })

    const signalQueue2: any[] = []
    peer2.on('signal', function (data) {
      signalQueue2.push(data)
      if (data.candidate) {
        while (signalQueue2[0]) peer1.signal(signalQueue2.pop())
      }
    })

    peer1.on('connect', function () {
      peer2.on('connect', function () {
        peer1.on('close', function () { })
        peer1.destroy()
        peer2.on('close', function () { resolve() })
        peer2.destroy()
      })
    })
  })
})

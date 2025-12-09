import bowser from 'bowser'

// create a test MediaStream with two tracks
let canvas: HTMLCanvasElement | undefined
export function getMediaStream (): MediaStream | Record<string, never> {
  if (typeof window === 'undefined') return {}

  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.width = canvas.height = 100
    canvas.getContext('2d') // initialize canvas
  }
  const stream = canvas.captureStream(30)
  stream.addTrack(stream.getTracks()[0].clone()) // should have 2 tracks
  return stream
}

export function isBrowser (name: string): boolean {
  if (typeof window === 'undefined') return false
  const satisfyObject: Record<string, unknown> = {}
  if (name === 'ios') { // bowser can't directly name iOS Safari
    satisfyObject.mobile = { safari: '>=0' }
  } else {
    satisfyObject[name] = '>=0'
  }
  const result = bowser.getParser(window.navigator.userAgent).satisfies(satisfyObject)
  return result !== undefined ? result : false
}

export default {
  isBrowser,
  getMediaStream
}

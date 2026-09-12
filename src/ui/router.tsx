/**
 * Minimal hash router. Hash routing keeps deep links working when the app is
 * opened from a file or installed to the home screen, with no server.
 */
import { useCallback, useEffect, useState } from 'react'

export interface Route {
  path: string
  segments: string[]
  query: URLSearchParams
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/home'
  const [pathPart, queryPart] = raw.split('?')
  const path = pathPart || '/home'
  return {
    path,
    segments: path.split('/').filter(Boolean),
    query: new URLSearchParams(queryPart ?? ''),
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse)
  useEffect(() => {
    const onChange = () => setRoute(parse())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(path: string): void {
  const target = path.startsWith('#') ? path : `#${path}`
  if (window.location.hash === target) {
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    return
  }
  window.location.hash = target
}

export function useNavigate(): (path: string) => void {
  return useCallback(navigate, [])
}

export function goBack(fallback = '/home'): void {
  if (window.history.length > 1) window.history.back()
  else navigate(fallback)
}

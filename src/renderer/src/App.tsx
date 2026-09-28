import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api } from './api'
import { SettingsDialog } from './components/SettingsDialog'
import { ToastProvider } from './components/ui'
import { Library } from './screens/Library'
import { Player } from './screens/Player'
import { Processing } from './screens/Processing'
import { Remote } from './screens/Remote'
import { Review } from './screens/Review'

export type Route =
  | { name: 'library' }
  | { name: 'processing'; id: string }
  | { name: 'review'; id: string; tab?: 'cast' | 'pages' }
  | { name: 'player'; id: string }
  | { name: 'remote'; id: string }

interface Nav {
  route: Route
  go: (r: Route) => void
  openSettings: (section?: string) => void
}

const NavCtx = createContext<Nav>({
  route: { name: 'library' },
  go: () => undefined,
  openSettings: () => undefined,
})
export const useNav = (): Nav => useContext(NavCtx)

/** `#tv/<comicId>/<beat>` – this window is the fullscreen TV screen. */
function tvTarget(): { id: string; beat: number } | null {
  const m = /^#tv\/([^/]+)\/(\d+)/.exec(window.location.hash)
  return m ? { id: decodeURIComponent(m[1]), beat: Number(m[2]) } : null
}

export function App(): React.JSX.Element {
  const tv = tvTarget()
  if (tv) {
    return (
      <ToastProvider>
        <Player id={tv.id} mode="tv" startBeat={tv.beat} />
      </ToastProvider>
    )
  }
  return <MainApp />
}

function MainApp(): React.JSX.Element {
  const [route, setRoute] = useState<Route>({ name: 'library' })
  const [settingsOpen, setSettingsOpen] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.classList.add(`platform-${api.platform}`)
  }, [])

  const go = useCallback((r: Route) => setRoute(r), [])
  const openSettings = useCallback((section?: string) => setSettingsOpen(section ?? 'all'), [])

  return (
    <ToastProvider>
      <NavCtx.Provider value={{ route, go, openSettings }}>
        <div className="app">
          {route.name === 'library' && <Library />}
          {route.name === 'processing' && <Processing key={route.id} id={route.id} />}
          {route.name === 'review' && <Review key={route.id} id={route.id} initialTab={route.tab} />}
          {route.name === 'player' && <Player key={route.id} id={route.id} />}
          {route.name === 'remote' && <Remote key={route.id} id={route.id} />}
        </div>
        {settingsOpen && <SettingsDialog focus={settingsOpen} onClose={() => setSettingsOpen(null)} />}
      </NavCtx.Provider>
    </ToastProvider>
  )
}

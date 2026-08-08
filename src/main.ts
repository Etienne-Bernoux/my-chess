import './ui/layout.css'
import { createApp } from './app'
import { systemClock } from './domain/clock'
import { browserStore } from './persistence/store'

const app = createApp({ clock: systemClock, store: browserStore() })

// Sans cela, chaque rechargement à chaud laisserait une boucle rAF orpheline.
import.meta.hot?.dispose(() => app.dispose())

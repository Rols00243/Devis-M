import { registerRootComponent } from 'expo';

import App from './src/App';

// registerRootComponent enregistre le composant racine et prépare l'environnement,
// aussi bien dans un build natif que dans le client de développement.
registerRootComponent(App);

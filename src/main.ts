import 'lenis/dist/lenis.css';
import '@fontsource/unbounded/300.css';
import '@fontsource/unbounded/500.css';
import '@fontsource/unbounded/900.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/main.css';
import { App } from './App';

new App().boot().catch((e) => {
  console.error(e);
  document.body.classList.add('no-webgl');
});

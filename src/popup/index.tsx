import { render } from 'preact';
import { App } from './App';
import '../popup/popup.css';

render(<App />, document.getElementById('app')!);

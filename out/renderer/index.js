import { jsx as _jsx } from "react/jsx-runtime";
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './CodeEditor';
const rootElement = document.getElementById('root');
const root = ReactDOM.createRoot(rootElement);
root.render(_jsx(App, {})); // Render the App component

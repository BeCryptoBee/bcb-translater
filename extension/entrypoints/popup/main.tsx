import React from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return <div>bcb-translater</div>;
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}

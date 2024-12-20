import React, { useState } from 'react';
import { Play } from 'lucide-react'; // Importing the Play icon from Lucide

import { transpile } from './transpiler/test';

const App = () => {
  const [code, setCode] = useState('');
  const [output, setOutput] = useState('');

  const handleRunCode = () => {
    try {
      // Evaluate the code entered by the user
      const result = transpile(code);
      setOutput(result);
    } catch (error: unknown) {
      if (error instanceof Error) {
        setOutput('Error: ' + error.message);
      } else {
        setOutput('Unknown error occurred');
      }
    }
  };
  
  // Handle Tab key to insert spaces
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const isTabKey = e.key === 'Tab';
    const isShiftPressed = e.shiftKey;
    const isCtrlPressed = e.ctrlKey;
    const isAltPressed = e.altKey;

    // If Tab is pressed without modifiers, insert two spaces
    if (isTabKey && !isShiftPressed && !isCtrlPressed && !isAltPressed) {
      e.preventDefault(); // Prevent the default tab behavior
      const target = e.currentTarget as HTMLTextAreaElement; // Cast to HTMLTextAreaElement
      const start = target.selectionStart;
      const end = target.selectionEnd;
      setCode(code.substring(0, start) + '  ' + code.substring(end)); // Insert two spaces
      // Move the cursor after the inserted spaces
      target.selectionStart = target.selectionEnd = start + 2;
    }

    // If Tab is pressed with Shift, Ctrl, or Alt, allow default behavior (focus change or indentation)
    if (isTabKey && (isShiftPressed || isCtrlPressed || isAltPressed)) {
      // Do nothing and allow the default tab behavior to occur
      return;
    }
  };

  return (
    <div className="flex h-screen text-white bg-gray-800 p-4">
      {/* Left Side: Code Editor */}
      <div className="w-1/2 p-4">
        <h2 className="text-xl font-bold mb-2">Code Editor</h2>
        <textarea
          className="w-full h-96 p-2 border border-gray-500 rounded-xl bg-gray-900"
          placeholder="Try something like: var x = 2"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>

      {/* Right Side: Output */}
      <div className="w-1/2 p-4">
        <h2 className="text-xl font-bold mb-2">Transpiled Output</h2>
        <div
          className="h-96 p-2 border border-gray-500 rounded-lg bg-gray-900 overflow-auto"
          style={{ minHeight: '300px' }}
        >
          <pre>{output}</pre>
        </div>
      </div>

      {/* Run Button */}
      <div className="absolute bottom-4 right-4">
        <button
          onClick={handleRunCode}
          className="bg-blue-500 text-white p-3 rounded-full flex items-center justify-center"
        >
          <Play className="mr-2" /> Run
        </button>
      </div>
    </div>
  );
};

export default App;

/* Runs model-generated Python inside the visitor's browser (Pyodide, WebAssembly).
   Module worker: Pyodide 314 dropped support for classic workers. */
import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs';

const runtime = loadPyodide().then(
  (py) => {
    postMessage({ type: 'ready' });
    return py;
  },
  (error) => {
    postMessage({ type: 'fatal', error: String(error) });
    throw error;
  },
);

onmessage = async (event) => {
  try {
    const py = await runtime;
    py.globals.set('PAYLOAD_JSON', JSON.stringify(event.data.payload));
    const output = py.runPython(event.data.harness + '\nrun_json(PAYLOAD_JSON)');
    postMessage({ type: 'result', ok: true, result: JSON.parse(output) });
  } catch (error) {
    postMessage({ type: 'result', ok: false, error: String(error).slice(-300) });
  }
};

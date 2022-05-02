import './App.css';
import {Routes, Route, Link} from 'react-router-dom';
function App() {
  return (
    <div className='App'>
      <Routes>
        <Route path='/' />
        <Route path='/subapp/react' />
        <Route path='/subapp/vue3' />
      </Routes>

      <Link to='/subapp/react'>react</Link>
      <Link to='/subapp/vue2'>vue2</Link>

      <div id='subapp-container'></div>
    </div>
  );
}

export default App;

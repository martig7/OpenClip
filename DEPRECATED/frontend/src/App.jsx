import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import RecordingsPage from './pages/RecordingsPage'
import ClipsPage from './pages/ClipsPage'
import StoragePage from './pages/StoragePage'

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Navbar />
        <div className="main-container">
          <Routes>
            <Route path="/" element={<RecordingsPage />} />
            <Route path="/clips" element={<ClipsPage />} />
            <Route path="/storage" element={<StoragePage />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  )
}

export default App

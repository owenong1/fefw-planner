import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { Layout } from './components/Layout'
import { BuilderPage } from './pages/BuilderPage'
import { ClassDetailPage } from './pages/ClassDetailPage'
import { ClassesPage } from './pages/ClassesPage'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ParaloguesPage } from './pages/ParaloguesPage'
import { PathsPage } from './pages/PathsPage'
import { RngPage } from './pages/RngPage'
import { RoutePage } from './pages/RoutePage'
import { SimPage } from './pages/SimPage'
import { SkillsPage } from './pages/SkillsPage'
import { UnitDetailPage } from './pages/UnitDetailPage'
import { UnitsPage } from './pages/UnitsPage'

function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0)
  }, [pathname, hash])
  return null
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="units" element={<UnitsPage />} />
          <Route path="units/:id" element={<UnitDetailPage />} />
          <Route path="classes" element={<ClassesPage />} />
          <Route path="classes/:id" element={<ClassDetailPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="routes/:id" element={<RoutePage />} />
          <Route path="builder" element={<BuilderPage />} />
          <Route path="rng" element={<RngPage />} />
          <Route path="paths" element={<PathsPage />} />
          <Route path="sim" element={<SimPage />} />
          <Route path="paralogues" element={<ParaloguesPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  )
}

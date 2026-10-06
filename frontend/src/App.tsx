// App shell: topbar, filter instrument, tabstrip, routed views.

import { Link, NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { FilterBar } from './FilterBar'
import { useRepos } from './store'
import { useFilters } from './filters'
import { StrataGlyph } from './components/Icons'
import { ToastHost } from './components/Toast'
import { Empty } from './components/Bits'
import { fmtCompact } from './format'
import { ReposView } from './views/ReposView'
import { OverviewView } from './views/OverviewView'
import { AuthorsView } from './views/AuthorsView'
import { FilesView } from './views/FilesView'
import { DirsView } from './views/DirsView'
import { CommitsView } from './views/CommitsView'
import { IdentitiesView } from './views/IdentitiesView'

const TABS = [
  ['overview', 'Overview'],
  ['authors', 'Authors'],
  ['files', 'Files'],
  ['dirs', 'Directories'],
  ['commits', 'Commits'],
  ['identities', 'Identities'],
] as const

function TopBar() {
  const { stats } = useRepos()
  return (
    <header className="topbar">
      <Link to="/d/overview" className="brand">
        <StrataGlyph />
        <span className="brand-name">STRATUM</span>
      </Link>
      <span className="brand-sub">git history analyzer</span>
      <nav className="topnav">
        <NavLink to="/d/overview" className={({ isActive }) => (isActive ? 'on' : '')}>
          Analysis
        </NavLink>
        <NavLink to="/repos" className={({ isActive }) => (isActive ? 'on' : '')}>
          Repositories
        </NavLink>
      </nav>
      <div className="topstats">
        <span>
          repos <b>{stats.repos}</b>
        </span>
        <span>
          commits <b>{fmtCompact(stats.commits)}</b>
        </span>
        <span>
          lines <b className="add">+{fmtCompact(stats.added)}</b> <b className="del">−{fmtCompact(stats.deleted)}</b>
        </span>
      </div>
    </header>
  )
}

function TabStrip() {
  const { f } = useFilters()
  return (
    <nav className="tabstrip">
      {TABS.map(([id, label]) => (
        <NavLink key={id} to={`/d/${id}`} className={({ isActive }) => (isActive ? 'on' : '')}>
          {label}
        </NavLink>
      ))}
      <div className="tabmeta">
        {f.commits.length > 0 && <span className="tag amber">{f.commits.length} commits selected</span>}
        {f.path && <span className="tag blue">path: {f.path.length > 40 ? '…' + f.path.slice(-40) : f.path}</span>}
      </div>
    </nav>
  )
}

function Dashboard() {
  const { tab } = useParams<{ tab: string }>()
  const { repos, loaded } = useRepos()
  const ready = repos.filter((r) => r.status === 'ready')

  if (!TABS.some(([id]) => id === tab)) return <Navigate to="/d/overview" replace />

  if (loaded && ready.length === 0) {
    return (
      <div className="content">
        <div className="page">
          <Empty
            title="No analyzed repositories yet"
            note="Add one from a .zip archive (with its .git directory) or clone a remote URL."
          >
            <Link to="/repos" className="btn primary" style={{ textDecoration: 'none' }}>
              Add a repository
            </Link>
          </Empty>
        </div>
      </div>
    )
  }

  return (
    <>
      <TabStrip />
      <div className="content">
        <div className="page">
          {tab === 'overview' && <OverviewView />}
          {tab === 'authors' && <AuthorsView />}
          {tab === 'files' && <FilesView />}
          {tab === 'dirs' && <DirsView />}
          {tab === 'commits' && <CommitsView />}
          {tab === 'identities' && <IdentitiesView />}
        </div>
      </div>
    </>
  )
}

function AnalysisShell() {
  return (
    <>
      <FilterBar />
      <Routes>
        <Route path="/d/:tab" element={<Dashboard />} />
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <div className="shell">
      <TopBar />
      <Routes>
        <Route path="/" element={<Navigate to="/d/overview" replace />} />
        <Route path="/repos" element={<ReposView />} />
        <Route path="/*" element={<AnalysisShell />} />
      </Routes>
      <ToastHost />
    </div>
  )
}

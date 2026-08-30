import { useState } from 'react'
import type { ReactNode } from 'react'
import { JudgeModeContext } from './judgeModeContext'

export function JudgeModeProvider({ children }: { children: ReactNode }) {
  const [judgeMode, setJudgeMode] = useState(() => {
    try { return localStorage.getItem('apix_judge_mode') === 'true' } catch { return false }
  })

  function toggleJudgeMode() {
    setJudgeMode((prev) => {
      const next = !prev
      try { localStorage.setItem('apix_judge_mode', String(next)) } catch {}
      return next
    })
  }

  return (
    <JudgeModeContext.Provider value={{ judgeMode, toggleJudgeMode }}>
      {children}
    </JudgeModeContext.Provider>
  )
}

import { createContext, useContext } from 'react'

export interface JudgeModeContextValue {
  judgeMode: boolean
  toggleJudgeMode: () => void
}

export const JudgeModeContext = createContext<JudgeModeContextValue>({
  judgeMode: false,
  toggleJudgeMode: () => {},
})

export function useJudgeMode() {
  return useContext(JudgeModeContext)
}

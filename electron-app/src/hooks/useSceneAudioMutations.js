import { useCallback } from 'react'
import api from '../api'
import { getAppAudioWindowKey, isAppAudioKind } from '../pages/games/audioSourceUtils'

/**
 * OBS scene audio add/remove + optimistic updates to local scene source list.
 */
export function useSceneAudioMutations({ showToast, setSceneAudioSources }) {
  const addSourceToScene = useCallback(
    async (sceneName, source) => {
      if (!sceneName) return
      try {
        const isVideoCapture =
          source.kind === 'game_capture' || source.kind === 'window_capture'
        const result = await api.addAudioSourceToScenes(
          [sceneName],
          source.kind,
          source.name,
          source.inputSettings || {},
          isVideoCapture ? { fitToCanvas: true } : {}
        )
        if (result.success) {
          if (isVideoCapture) {
            showToast(`"${source.name}" added to scene`)
          } else {
            let conflictWarning = null
            setSceneAudioSources((prev) => {
              const already = prev.some((s) => s.inputName === source.name)
              if (already) return prev
              if (isAppAudioKind(source.kind)) {
                const newKey = getAppAudioWindowKey(source.name, source.inputSettings?.window)
                const duplicate = prev.find(
                  (s) =>
                    isAppAudioKind(s.inputKind) &&
                    getAppAudioWindowKey(s.inputName, s.inputSettings?.window) === newKey
                )
                if (duplicate) conflictWarning = duplicate.inputName
              }
              return [
                ...prev,
                {
                  inputName: source.name,
                  inputKind: source.kind,
                  inputSettings: source.inputSettings || {},
                },
              ]
            })
            if (conflictWarning) {
              showToast(
                `OBS doesn't support two Application Audio sources for the same window — OBS will default to "${conflictWarning}" (the first source added).`
              )
            } else {
              showToast(`"${source.name}" added to scene`)
            }
          }
        } else {
          showToast(`Warning: ${result.message}`)
        }
      } catch (err) {
        showToast(`Failed: ${err.message}`)
      }
    },
    [showToast, setSceneAudioSources]
  )

  const removeSourceFromScene = useCallback(
    async (sceneName, inputName) => {
      if (!sceneName) return
      try {
        const result = await api.removeAudioSourceFromScenes([sceneName], inputName)
        if (result.success) {
          setSceneAudioSources((prev) => prev.filter((s) => s.inputName !== inputName))
          showToast(`"${inputName}" removed from scene`)
        } else {
          showToast(`Warning: ${result.message}`)
        }
      } catch (err) {
        showToast(`Failed: ${err.message}`)
      }
    },
    [showToast, setSceneAudioSources]
  )

  return { addSourceToScene, removeSourceFromScene }
}

import React from 'react'
import { usePlanningDialogStore } from '@/store/usePlanningDialogStore'
import AutoPlaceModal from '@/components/AutoPlaceModal/AutoPlaceModal'
import AutoPowerModal from '@/components/AutoPowerModal/AutoPowerModal'
import Redundant24Modal from '@/components/Redundant24Modal/Redundant24Modal'

// The planning dialogs, mounted once for the whole app (see
// usePlanningDialogStore).
function PlanningDialogs() {
  const dialog = usePlanningDialogStore((s) => s.dialog)
  const apIds = usePlanningDialogStore((s) => s.apIds)
  const closeDialog = usePlanningDialogStore((s) => s.closeDialog)
  return (
    <>
      <AutoPlaceModal open={dialog === 'autoPlace'} onClose={closeDialog} />
      <AutoPowerModal open={dialog === 'autoPower'} apIds={apIds} onClose={closeDialog} />
      <Redundant24Modal open={dialog === 'redundant24'} onClose={closeDialog} />
    </>
  )
}

export default PlanningDialogs

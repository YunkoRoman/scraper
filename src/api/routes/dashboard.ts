import express from 'express'
import type { RunPersistenceService } from '../../infrastructure/db/RunPersistenceService.js'

interface Deps {
  runPersistence: RunPersistenceService
}

export function createDashboardRouter({ runPersistence }: Deps) {
  const router = express.Router()

  router.get('/performance', async (_req, res) => {
    const days = await runPersistence.getPerformanceLast30Days()
    res.json({ days })
  })

  return router
}

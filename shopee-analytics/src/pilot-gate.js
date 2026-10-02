'use strict';

function evaluatePilotGate({
  syncSummary,
  validationReport,
  reconciliation,
  productCardRows = 0,
}) {
  const gates = [
    {
      key: 'sync',
      pass: Boolean(syncSummary && syncSummary.ok),
      detail: syncSummary ? syncSummary.failedRequiredSteps || [] : ['missing sync summary'],
    },
    {
      key: 'data_health',
      pass: Boolean(validationReport && validationReport.dataHealth && validationReport.dataHealth.ok),
      detail: validationReport?.dataHealth?.warnings || [],
    },
    {
      key: 'seller_centre_reconciliation',
      pass: Boolean(reconciliation && reconciliation.pass),
      detail: reconciliation?.checks || [],
    },
    {
      key: 'product_card_exact_period',
      pass: Number(productCardRows) > 0,
      detail: { productCardRows: Number(productCardRows || 0) },
    },
  ];
  const failed = gates.filter(row => !row.pass);
  return {
    pass: failed.length === 0,
    gates,
    failedGates: failed.map(row => row.key),
    nextGate: failed.length ? 'FIX_PILOT_ACCEPTANCE' : 'HISTORICAL_BACKFILL_ALLOWED',
  };
}

module.exports = { evaluatePilotGate };

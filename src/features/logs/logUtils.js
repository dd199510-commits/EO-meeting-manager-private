export function readLogs(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function persistLogs(storageKey, logs) {
  window.localStorage.setItem(storageKey, JSON.stringify(logs))
}

export function createLog(actionType, targetName, detail, changes = []) {
  return {
    id: crypto.randomUUID(),
    actionType,
    targetName,
    detail,
    changes,
    timestamp: Date.now(),
  }
}

export function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString('zh-CN')
}

export function getActionLabel(actionType) {
  const labels = {
    create: '创建',
    update: '更新',
    delete: '删除',
    restore: '恢复',
    hard_delete: '永久删除',
    reorder: '重排',
    review: '审核调整',
    review_import: '审核导入',
    review_delete: '审核删除',
    review_move: '审核移动',
    import: '导入',
    batch_import: '批量导入',
  }

  return labels[actionType] || actionType
}

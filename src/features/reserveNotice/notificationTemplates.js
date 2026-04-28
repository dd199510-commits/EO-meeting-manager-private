export const BUILT_IN_NOTICE_TEMPLATES = {
  general: {
    key: 'general',
    label: '通用通知',
    content: '大家好，【会议名称】计划安排如下：\n【安排列表】\n请各位知悉并预留时间，谢谢！',
    isBuiltIn: true,
  },
  monthly_general: {
    key: 'monthly_general',
    label: '月度会通知',
    content: '大家好，【月份】的【会议名称】计划安排如下：\n【安排列表】\n请各位知悉并预留时间，谢谢！',
    isBuiltIn: true,
  },
  one_on_one_exec: {
    key: 'one_on_one_exec',
    label: '1-1 通知',
    content: '【秘书名称】好，下个月【高管名称】和 Robin 的 1-1 计划安排如下：\n【安排列表】\n辛苦预留。',
    isBuiltIn: true,
  },
}

export const BUILT_IN_NOTICE_TEMPLATE_KEYS = Object.keys(BUILT_IN_NOTICE_TEMPLATES)

export const NOTICE_VARIABLE_OPTIONS = [
  '【会议名称】',
  '【日期】',
  '【时间】',
  '【月份】',
  '【星期】',
  '【参会人】',
  '【高管名称】',
  '【秘书名称】',
  '【安排列表】',
  '【本阶段安排次数】',
  '【首次安排日期】',
  '【最后安排日期】',
  '【会议类型】',
  '【最近一次发生日期】',
  '【备注摘要】',
]

export function normalizeNoticeTemplates(input) {
  if (!Array.isArray(input)) return []

  return input
    .filter((item) => item && typeof item === 'object')
    .map((template) => ({
      key: String(template.key || `custom-${crypto.randomUUID()}`),
      label: String(template.label || '未命名模板'),
      content: String(template.content || ''),
      isBuiltIn: false,
    }))
}

export function getMergedNoticeTemplates(customTemplates = [], disabledBuiltInKeys = []) {
  const disabledSet = new Set(Array.isArray(disabledBuiltInKeys) ? disabledBuiltInKeys : [])
  const merged = Object.fromEntries(
    Object.entries(BUILT_IN_NOTICE_TEMPLATES).filter(([key]) => !disabledSet.has(key)),
  )

  normalizeNoticeTemplates(customTemplates).forEach((template) => {
    merged[template.key] = template
  })

  return merged
}

export function getNoticeTemplateOptions(customTemplates = [], disabledBuiltInKeys = []) {
  return Object.values(getMergedNoticeTemplates(customTemplates, disabledBuiltInKeys)).map((template) => ({
    value: template.key,
    label: template.label,
    isBuiltIn: Boolean(template.isBuiltIn),
  }))
}

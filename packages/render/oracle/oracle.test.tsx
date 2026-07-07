// @vitest-environment jsdom
import React from 'react'
import { render, cleanup, waitFor } from '@testing-library/react'
import fs from 'node:fs'

const OUTDIR = '/Users/sambit/Contextifly/packages/render/oracle'

const H = vi.hoisted(() => ({ canEdit: true }))
vi.mock('@/components/providers/permissions-provider', () => ({ useHasPermission: () => H.canEdit }))
vi.mock('@/hooks/use-toast', () => ({ toast: () => {}, useToast: () => ({ toast: () => {} }) }))

import { GeneralSettingsCard } from '@/app/(dashboard)/cities/[id]/general-settings-card'

const AUTO = JSON.parse(fs.readFileSync('/Users/sambit/Contextifly/packages/render/env.auto.json', 'utf8'))
const fetchOk = (ed: any) => () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ extraDetails: ed }) })
const fetchErr = () => () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
const fetchPending = () => () => new Promise(() => {})

function classify(el: Element) {
  const tag = el.tagName.toLowerCase()
  if (tag === 'svg') return 'icon'
  if (el.getAttribute('role') === 'switch') return 'switch'
  if (tag === 'input') return 'input'
  if (tag === 'button') return 'button'
  if (['h1','h2','h3','h4','h5','h6','p','label','span'].includes(tag) && el.children.length === 0) return 'text'
  return 'box'
}
function model(el: Element): any {
  const tag = el.tagName.toLowerCase(), role = classify(el)
  const n: any = { tag, role, cls: el.getAttribute('class') || '' }
  const own = Array.from(el.childNodes).filter(c => c.nodeType === 3).map(c => (c.textContent || '').trim()).filter(Boolean).join(' ')
  if (own) n.text = own
  if (el.getAttribute('data-state')) n.dataState = el.getAttribute('data-state')
  if (el.hasAttribute('aria-checked')) n.ariaChecked = el.getAttribute('aria-checked')
  if (el.hasAttribute('disabled') || el.getAttribute('data-disabled') != null || el.getAttribute('aria-disabled') === 'true') n.disabled = true
  if (tag === 'input') { n.value = (el as any).value ?? el.getAttribute('value') ?? ''; n.placeholder = el.getAttribute('placeholder') }
  if (role !== 'icon' && role !== 'switch') { const kids = Array.from(el.children).map(model); if (kids.length) n.children = kids }
  return n
}

async function snap(id: string, canEdit: boolean, fetchImpl: any, isLoading: boolean) {
  H.canEdit = canEdit
  ;(global as any).fetch = fetchImpl
  const { container } = render(React.createElement(GeneralSettingsCard, { id: 'city_123' }))
  if (!isLoading) await waitFor(() => { if ((container.textContent || '').includes('Loading')) throw new Error('still loading') })
  const root = container.firstElementChild
  fs.writeFileSync(`${OUTDIR}/real.${id}.json`, JSON.stringify(root ? model(root) : { role: 'empty' }, null, 2))
  const txt = (container.textContent || '')
  console.log(`[${id}] canEdit=${canEdit} textLen=${txt.length} head="${txt.slice(0, 46).replace(/\s+/g, ' ')}"`)
  cleanup()
}

it('captures the REAL component per auto-derived keyframes', async () => {
  for (const kf of AUTO.keyframes) {
    const env = AUTO.envs[kf.id]
    const fetchImpl = env.loading ? fetchPending() : !env.extraDetails ? fetchErr() : fetchOk(env.extraDetails)
    await snap(kf.id, env.canEdit, fetchImpl, !!env.loading)
  }
  expect(AUTO.keyframes.length).toBeGreaterThan(0)
})

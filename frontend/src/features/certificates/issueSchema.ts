import { z } from 'zod'

import { hasForbiddenCharacters } from '@/lib/utils'
import type { CreateCertificateInput } from '@/types/certificate'

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `Enter the ${label}.`)
    .max(max, `The ${label} must be ${max} characters or fewer.`)
    .refine((v) => !hasForbiddenCharacters(v), `The ${label} contains characters that are not allowed.`)

/** End of the chosen calendar day in the user's time zone (whole seconds). */
export function endOfDayIso(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 59, 0).toISOString()
}

export const issueSchema = z.object({
  recipient_name: text('recipient name', 120),
  recipient_email: z
    .string()
    .trim()
    .max(254, 'The email must be 254 characters or fewer.')
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email address or leave this empty.'),
  course_name: text('course or achievement', 200),
  organization_name: text('issuing organization', 200),
  expiry_date: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Enter a valid date.')
    .refine((v) => v === '' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(endOfDayIso(v)).getTime() > Date.now(), 'The expiry date must be in the future.'),
})

export type IssueFormValues = z.infer<typeof issueSchema>

export const issueDefaults: IssueFormValues = { recipient_name: '', recipient_email: '', course_name: '', organization_name: '', expiry_date: '' }

export function toCreateInput(values: IssueFormValues): CreateCertificateInput {
  return {
    recipient_name: values.recipient_name,
    course_name: values.course_name,
    organization_name: values.organization_name,
    recipient_email: values.recipient_email || null,
    expiry_date: values.expiry_date ? endOfDayIso(values.expiry_date) : null,
  }
}

export const issueFieldNames = Object.keys(issueDefaults) as Array<keyof IssueFormValues>

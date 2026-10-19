import { z } from 'zod'

import { hasForbiddenCharacters } from '@/lib/utils'

export const revokeSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Give a reason of at least 3 characters.')
    .max(500, 'The reason must be 500 characters or fewer.')
    .refine((v) => !hasForbiddenCharacters(v), 'The reason contains characters that are not allowed.'),
})

export type RevokeValues = z.infer<typeof revokeSchema>

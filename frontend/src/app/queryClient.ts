import { QueryClient } from '@tanstack/react-query'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, staleTime: 15_000, gcTime: 5 * 60_000 },
      mutations: { retry: false },
    },
  })
}

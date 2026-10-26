import { createTRPCReact } from "@trpc/react-query";
import { httpLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { ReactNode } from "react";

// Inline AppRouter type to avoid importing backend files
type AppRouter = {
  stock: {
    search: any;
    getInfo: any;
    getHistoricalData: any;
    count: any;
    bulkInsert: any;
  };
  analysis: {
    findSimilarStocks: any;
    findSimilarStocksWithPatterns: any;
    detectPatterns: any;
    getAllStocks: any;
    bulkInsert: any;
  };
};

export const trpc = createTRPCReact<AppRouter>();

// Force side effect to prevent tree-shaking
if (typeof window !== "undefined") {
  (window as any).__trpc_loaded__ = true;
}

const queryClient = new QueryClient();
const trpcClient = trpc.createClient({
  transformer: superjson,
  links: [
    httpLink({
      url: "/api/trpc",
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}

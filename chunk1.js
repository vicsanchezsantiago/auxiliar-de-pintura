<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <script type="module" src="/@vite/client"></script>

  <meta charset="utf-8" />
  <title>Miniature Painting Assistant</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  <!-- Tailwind CDN removed (caused constructable stylesheet @import issues). -->
  <style>
    /* Custom scrollbar for a better dark theme aesthetic */
    ::-webkit-scrollbar {
      width: 8px;
    }
    ::-webkit-scrollbar-track {
      background: #1f2937; /* bg-gray-800 */
    }
    ::-webkit-scrollbar-thumb {
      background: #4b5563; /* bg-gray-600 */
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: #6b7280; /* bg-gray-500 */
    }
    @media print {
      .no-print {
        display: none !important;
      }
      body {
        background-color: white !important;
        color: black !important;
      }
      .print-bg-white {
        background-color: white !important;
      }
      .print-text-black {
        color: black !important;
      }
      .print-border {
        border: 1px solid #ccc;
      }
    }
  </style>
</head>
<body class="bg-gray-900 text-gray-100 antialiased">
  <app-root>
    <!-- Loading State for better UX -->
    <div class="flex flex-col items-center justify-center min-h-screen">
      <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-teal-500 mb-4"></div>
      <p class="text-teal-400 font-medium tracking-wider">CARREGANDO...</p>
    </div>
  </app-root>
  <script type="module" src="/index.tsx"></script>
</body>
</html>
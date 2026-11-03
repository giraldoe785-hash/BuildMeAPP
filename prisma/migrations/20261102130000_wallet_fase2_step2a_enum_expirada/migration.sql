-- Fase 2 Fixi Wallet: estado terminal local para recargas sin confirmacion remota (> 30 min).
ALTER TYPE "estado_recarga_wallet" ADD VALUE IF NOT EXISTS 'EXPIRADA_LOCALMENTE';

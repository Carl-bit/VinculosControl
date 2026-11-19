-- Vencimiento de demos (2026-11-19): fecha de baja automatica y job ELIMINAR_DEMO. Aditiva.
ALTER TYPE "tipo_job" ADD VALUE 'ELIMINAR_DEMO';
ALTER TABLE "centros" ADD COLUMN "demo_vence_en" TIMESTAMP(3);
-- Demos que ya existian: vencen en 24 h desde la migracion.
UPDATE "centros" SET "demo_vence_en" = now() + interval '24 hours' WHERE "origen" = 'demo' AND "estado" <> 'ELIMINADO';

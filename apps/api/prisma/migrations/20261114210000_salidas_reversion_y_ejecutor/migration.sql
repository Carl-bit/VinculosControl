-- AlterEnum


ALTER TYPE "tipo_job" ADD VALUE 'DETENER_SILO';
ALTER TYPE "tipo_job" ADD VALUE 'REANUDAR_SILO';

-- DropIndex
DROP INDEX "salidas_centro_id_key";

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "referencia" TEXT;

-- AlterTable
ALTER TABLE "salidas" ADD COLUMN     "abierta" BOOLEAN DEFAULT true,
ADD COLUMN     "acta_reversion" JSONB,
ADD COLUMN     "acta_reversion_hash" TEXT,
ADD COLUMN     "detencion_job_id" INTEGER,
ADD COLUMN     "eliminacion_job_id" INTEGER,
ADD COLUMN     "reversion_job_id" INTEGER,
ADD COLUMN     "reversion_medio" TEXT,
ADD COLUMN     "reversion_motivo" TEXT,
ADD COLUMN     "reversion_pedida_en" TIMESTAMP(3),
ADD COLUMN     "reversion_pedida_por" TEXT,
ADD COLUMN     "reversion_ref" TEXT,
ADD COLUMN     "reversion_solicitud_en" TIMESTAMP(3),
ADD COLUMN     "revertida_en" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "salidas_centro_id_abierta_key" ON "salidas"("centro_id", "abierta");


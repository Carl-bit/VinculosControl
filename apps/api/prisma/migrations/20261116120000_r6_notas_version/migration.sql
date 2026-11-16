-- R6: notas de version que escribe el operador (sin datos personales). Aditiva.
ALTER TABLE "releases" ADD COLUMN "notas" TEXT;
ALTER TABLE "releases" ADD COLUMN "notas_en" TIMESTAMP(3);
ALTER TABLE "releases" ADD COLUMN "notas_por" TEXT;

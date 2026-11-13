import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/*
 * Lo unico que el agente puede mandar: numeros, booleanos y nombres tecnicos.
 * Nada de lineas de log, cuerpos, usuarios ni datos de pacientes (CLAUDE.md,
 * regla 1). El p95 llega ya calculado; la ruta va sin ids ni query.
 */

export class LatidoDto {
  @IsString()
  @MaxLength(40)
  version!: string;
}

export class HostDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  discoPct!: number;

  @IsInt()
  @Min(0)
  memUsada!: number;

  @IsInt()
  @Min(0)
  memTotal!: number;

  @IsNumber()
  @Min(0)
  carga1!: number;

  @IsInt()
  @Min(1)
  @Max(512)
  cpus!: number;
}

export class ContenedorDto {
  @IsIn(['db', 'backend', 'frontend'])
  servicio!: string;

  @IsNumber()
  @Min(0)
  cpuPct!: number;

  @IsInt()
  @Min(0)
  memBytes!: number;

  @IsInt()
  @Min(0)
  memLimite!: number;

  @IsInt()
  @Min(0)
  reinicios!: number;

  @IsBoolean()
  oom!: boolean;

  @IsString()
  @Matches(/^[a-z]{3,12}$/)
  estado!: string;
}

export class LatenciaDto {
  /** "GET /api/citas/:id": metodo + ruta normalizada (sin ids, numeros ni query). */
  @IsString()
  @MaxLength(200)
  @Matches(/^[A-Z]{3,7} \/[\w/:.-]*$/)
  ruta!: string;

  @IsInt()
  @Min(1)
  n!: number;

  @IsInt()
  @Min(0)
  p50!: number;

  @IsInt()
  @Min(0)
  p95!: number;

  @IsInt()
  @Min(0)
  max!: number;
}

export class RespaldoDto {
  /** Nombre que escribe respaldar.sh: <slug>-AAAAMMDDTHHMMSSZ.dump.enc */
  @IsString()
  @Matches(/^[a-z0-9-]+-\d{8}T\d{6}Z\.dump\.enc$/)
  archivo!: string;

  @IsISO8601()
  fecha!: string;

  @IsInt()
  @Min(0)
  bytes!: number;

  @IsOptional()
  @Matches(/^[a-f0-9]{64}$/)
  sha256?: string;
}

export class SiloReporteDto {
  @Matches(/^[a-z0-9-]{1,40}$/)
  slug!: string;

  @IsOptional()
  @Matches(/^[a-z0-9.-]{1,253}$/)
  dominio?: string;

  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ContenedorDto)
  contenedores!: ContenedorDto[];

  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => LatenciaDto)
  latencias!: LatenciaDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => RespaldoDto)
  respaldo?: RespaldoDto;
}

export class ReporteDto {
  @ValidateNested()
  @Type(() => HostDto)
  host!: HostDto;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SiloReporteDto)
  silos!: SiloReporteDto[];
}

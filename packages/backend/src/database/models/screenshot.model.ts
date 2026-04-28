import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type { ScreenshotStatus } from '@contextify/shared';

@Table({ tableName: 'screenshots', timestamps: true })
export class Screenshot extends Model<Screenshot> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare originalFilename: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare mimeType: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare sizeBytes: number;

  @Column({ type: DataType.STRING, allowNull: false })
  declare storagePath: string;

  @Column({
    type: DataType.ENUM('queued', 'processing', 'done', 'failed'),
    allowNull: false,
    defaultValue: 'queued',
  })
  declare status: ScreenshotStatus;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare markdown: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  declare imageTokensEstimate: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  declare markdownTokens: number | null;

  @Column({ type: DataType.FLOAT, allowNull: true })
  declare savingsPercent: number | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare errorMessage: string | null;
}

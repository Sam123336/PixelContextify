import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { Screenshot } from './models/screenshot.model';

@Module({
  imports: [
    SequelizeModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        dialect: 'postgres' as const,
        uri: config.get<string>('databaseUrl'),
        models: [Screenshot],
        autoLoadModels: true,
        synchronize: true,
        logging: false,
      }),
    }),
    SequelizeModule.forFeature([Screenshot]),
  ],
  exports: [SequelizeModule],
})
export class DatabaseModule {}

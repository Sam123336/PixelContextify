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
        // Managed Postgres (Azure, etc.) requires TLS. rejectUnauthorized is
        // false because the connection terminates at the provider's own CA.
        ...(config.get<boolean>('databaseSsl')
          ? {
              dialectOptions: {
                ssl: { require: true, rejectUnauthorized: false },
              },
            }
          : {}),
      }),
    }),
    SequelizeModule.forFeature([Screenshot]),
  ],
  exports: [SequelizeModule],
})
export class DatabaseModule {}

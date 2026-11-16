import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '@Auth';
import { JwtAuthGuard, RolesGuard } from '@Auth/guards';
import { HealthModule } from '@Health';
import { ListingsModule } from '@Listings';
import { MessagingModule } from '@Messaging';
import { NotificationsModule } from '@Notifications';
import { PrismaModule } from '@Prisma';
import { ReportsModule } from '@Reports';
import { UsersModule } from '@Users';
import { validateEnv } from '@Config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Si falta DATABASE_URL o JWT_SECRET, la app no arranca.
      validate: validateEnv,
    }),
    PrismaModule,
    HealthModule,
    UsersModule,
    AuthModule,
    ListingsModule,
    NotificationsModule,
    MessagingModule,
    ReportsModule,
  ],
  providers: [
    {
      // Todo cerrado por defecto: las rutas públicas se abren con @Public().
      provide: APP_GUARD,
      useExisting: JwtAuthGuard,
    },
    {
      // Después del JWT (el orden importa): revisa @Roles con el usuario ya cargado.
      provide: APP_GUARD,
      useExisting: RolesGuard,
    },
  ],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '@Auth';
import { DeliveriesModule } from '@Deliveries';
import { JwtAuthGuard, RolesGuard } from '@Auth/guards';
import { AvailabilityModule } from '@Availability';
import { HealthModule } from '@Health';
import { IncomeModule } from '@Income';
import { ListingsModule } from '@Listings';
import { MessagingModule } from '@Messaging';
import { NotificationsModule } from '@Notifications';
import { PaymentsModule } from '@Payments';
import { PrismaModule } from '@Prisma';
import { ReportsModule } from '@Reports';
import { ReservationDecisionsModule } from '@ReservationDecisions';
import { ReturnsModule } from '@Returns';
import { UsersModule } from '@Users';
import { VerificationModule } from '@Verification';
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
    AvailabilityModule,
    NotificationsModule,
    MessagingModule,
    PaymentsModule,
    VerificationModule,
    DeliveriesModule,
    ReturnsModule,
    ReservationDecisionsModule,
    IncomeModule,
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

import { Module } from '@nestjs/common';
import { MessagingController } from '@Messaging/controllers';
import { ConversationRepository } from '@Messaging/repositories';
import { MessagingService } from '@Messaging/services';
import { NotificationsModule } from '@Notifications';

/** Módulo 5: Mensajería (H15, H16). Avisa por medio del Módulo 8. */
@Module({
  imports: [NotificationsModule],
  controllers: [MessagingController],
  providers: [MessagingService, ConversationRepository],
})
export class MessagingModule {}

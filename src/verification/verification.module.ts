import { Module } from '@nestjs/common';
import { IdentityVerificationRepository } from '@Verification/repositories';

@Module({
  providers: [IdentityVerificationRepository],
  exports: [IdentityVerificationRepository],
})
export class VerificationModule {}

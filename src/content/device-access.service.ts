import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DeviceAccess } from './schemas/device-access.schema';

type DeviceAction = 'flashcard' | 'singlePlayer' | 'battle';

@Injectable()
export class DeviceAccessService {
  private readonly logger = new Logger(DeviceAccessService.name);

  constructor(
    @InjectModel(DeviceAccess.name)
    private readonly deviceModel: Model<DeviceAccess>,
  ) {}

  /**
   * Ensures we have a device record and bumps the generic access counter.
   */
  async registerAccess(deviceId: string): Promise<DeviceAccess> {
    if (!deviceId) {
      throw new UnauthorizedException('Device ID is required');
    }

    const now = new Date();
    const record = await this.deviceModel
      .findOneAndUpdate(
        { deviceId },
        {
          $setOnInsert: { deviceId },
          $inc: { accessCount: 1 },
          $set: { lastActionAt: now },
        },
        { upsert: true, new: true },
      )
      .exec();

    if (!record) {
      throw new UnauthorizedException('Unable to register device access');
    }

    return record;
  }

  /**
   * Verifies whether a device can perform a limited action (default 3 times).
   * If allowed, we also increment the corresponding counters atomically.
   */
  async assertActionAllowed(
    deviceId: string,
    action: DeviceAction,
    maxActions = 3,
  ): Promise<DeviceAccess> {
    const record = await this.registerAccess(deviceId);
    const fieldMap: Record<
      DeviceAction,
      'flashcardUploads' | 'singlePlayerGames' | 'battleGames'
    > = {
      flashcard: 'flashcardUploads',
      singlePlayer: 'singlePlayerGames',
      battle: 'battleGames',
    };

    const currentValue = Number(record[fieldMap[action]] ?? 0);

    if (currentValue >= (record.maxActions ?? maxActions)) {
      this.logger.warn(
        `Device ${deviceId} exceeded limit for ${action}: ${currentValue}`,
      );
      throw new UnauthorizedException('Device usage limit reached');
    }

    const updated = await this.deviceModel
      .findOneAndUpdate(
        { deviceId },
        {
          $inc: { [fieldMap[action]]: 1 },
          $set: { lastActionAt: new Date() },
          $push: { actionHistory: action },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new UnauthorizedException('Unable to update device usage');
    }

    return updated;
  }
}

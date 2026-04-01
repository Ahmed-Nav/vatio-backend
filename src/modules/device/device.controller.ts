import { Controller, Post, Get, Delete, Patch, Body, Param, Req, Logger } from '@nestjs/common';
import { DeviceService } from './device.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

@Controller('devices')
export class DeviceController {
    private readonly logger = new Logger(DeviceController.name);
    constructor(private readonly deviceService: DeviceService) { }

    @Post()
    async register(@Req() req, @Body() dto: CreateDeviceDto) {
        return this.deviceService.create(req.user.userId, dto);
    }

    @Get()
    async getMyDevices(@Req() req) {
        this.logger.log(`getMyDevices called — req.user = ${JSON.stringify(req.user)}`);
        try {
            const result = await this.deviceService.findAll(req.user.userId);
            this.logger.log(`getMyDevices found ${result.length} devices`);
            return result;
        } catch (error) {
            this.logger.error(`getMyDevices FAILED: ${error.message}`, error.stack);
            throw error;
        }
    }

    @Get(':id')
    async getDevice(@Req() req, @Param('id') id: string) {
        return this.deviceService.findOne(req.user.userId, id);
    }

    @Patch(':id')
    async updateDevice(@Req() req, @Param('id') id: string, @Body() dto: UpdateDeviceDto) {
        return this.deviceService.update(req.user.userId, id, dto);
    }

    @Delete(':id')
    async unregister(@Req() req, @Param('id') id: string) {
        return this.deviceService.remove(req.user.userId, id);
    }
}
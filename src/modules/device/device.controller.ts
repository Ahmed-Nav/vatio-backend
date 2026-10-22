import { Controller, Post, Get, Delete, Patch, Body, Param, Req } from '@nestjs/common';
import { DeviceService } from './device.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { AssignOwnerDto } from './dto/assign-owner.dto';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('devices')
export class DeviceController {
    constructor(private readonly deviceService: DeviceService) { }

    @Roles('admin')
    @Post()
    async register(@Req() req, @Body() dto: CreateDeviceDto) {
        return this.deviceService.create(req.user.userId, dto);
    }

    @Get()
    async getMyDevices(@Req() req) {
        return this.deviceService.findAll(req.user.userId, req.user.role);
    }

    @Get(':id')
    async getDevice(@Req() req, @Param('id') id: string) {
        return this.deviceService.findOne(req.user.userId, id, req.user.role);
    }

    @Roles('admin')
    @Patch(':id')
    async updateDevice(@Req() req, @Param('id') id: string, @Body() dto: UpdateDeviceDto) {
        return this.deviceService.update(req.user.userId, id, dto);
    }

    @Roles('admin')
    @Patch(':id/owner')
    async assignOwner(@Req() req, @Param('id') id: string, @Body() dto: AssignOwnerDto) {
        return this.deviceService.setOwner(req.user.userId, id, dto.userId);
    }

    @Roles('admin')
    @Delete(':id')
    async unregister(@Req() req, @Param('id') id: string) {
        return this.deviceService.remove(req.user.userId, id);
    }
}

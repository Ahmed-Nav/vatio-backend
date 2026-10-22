import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('users')
@Roles('admin')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  findAll() {
    return this.userService.findAll();
  }

  @Patch(':id')
  update(@Req() req, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.userService.update(req.user.userId, id, dto);
  }
}
